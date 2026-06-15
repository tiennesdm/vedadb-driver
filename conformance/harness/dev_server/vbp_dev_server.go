// Package main: a minimal VBP v1 reference test server for the
// vedadb-driver Go conformance harness. This is INDEPENDENT of the
// vedadb engine's internal/wire/vbp package (which has a Go
// internal-package resolver issue that prevents the harness from
// importing it directly). It implements just enough of the VBP v1
// spec to make the harness's "connect", "hello", "auth", "query",
// "result", "txn" tests runnable.
//
// Supported opcodes:
//
//	0x01 CLIENT_HELLO → 0x02 SERVER_READY → (no auth in dev mode) →
//	  0x05 AUTH_OK
//	0x06 QUERY        → 0x0A DATA_CHUNK + 0x0B ROWS_FINISHED + 0x0C COMMAND_COMPLETE
//	0x16 PING         → 0x17 PONG
//	0x18 CLOSE        → connection closed
//
// All other opcodes get ERROR 0x0D with sqlstate 0A000 (or 42601
// for bad QUERY text).
//
// Mock VedaQL: a tiny parser that handles
//
//	SELECT <int> AS <name>           → 1 row, 1 col
//	SELECT 1                         → 1 row, 1 col (T_INT4)
//	BEGIN / COMMIT / ROLLBACK        → ack with status byte
//	CREATE TABLE x ... / DROP TABLE  → ack
//	anything else                    → ERROR 42601
//
// Usage:
//
//	go run ./conformance/harness/dev_server -addr 127.0.0.1:6380
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const magicVDB = "VDB"

const (
	opClientHello     = 0x01
	opServerReady     = 0x02
	opAuthChallenge   = 0x03
	opAuthResponse    = 0x04
	opAuthOK          = 0x05
	opQuery           = 0x06
	opDataChunk       = 0x0A
	opRowsFinished    = 0x0B
	opCommandComplete = 0x0C
	opError           = 0x0D
	opPing            = 0x16
	opPong            = 0x17
	opClose           = 0x18

	tInt4 = uint16(23)
	tInt8 = uint16(20)
	tText = uint16(25)
	tBool = uint16(16)
)

func main() {
	var (
		addr = flag.String("addr", "127.0.0.1:6380", "listen address")
		user = flag.String("user", "admin", "dev-mode PLAIN user")
	)
	flag.Parse()

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	fmt.Fprintf(os.Stdout, "vbp_dev_server: listening on %s (dev mode, user=%s)\n", ln.Addr(), *user)
	_ = user

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		sigc := make(chan os.Signal, 1)
		signal.Notify(sigc, syscall.SIGINT, syscall.SIGTERM)
		<-sigc
		fmt.Fprintln(os.Stderr, "vbp_dev_server: shutting down")
		cancel()
		_ = ln.Close()
	}()

	var wg sync.WaitGroup
	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				break
			}
			log.Printf("accept: %v", err)
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			serveConn(ctx, conn)
		}()
	}
	wg.Wait()
}

func serveConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	r := bufio.NewReaderSize(conn, 64*1024)
	w := bufio.NewWriterSize(conn, 64*1024)
	defer w.Flush()

	// Wait for CLIENT_HELLO
	seq, op, _, body, err := readFrame(r)
	if err != nil {
		log.Printf("read hello: %v", err)
		return
	}
	if op != opClientHello {
		_ = writeFrame(w, 0, opError, 0, errorBody("0A000", "expected CLIENT_HELLO", "", ""))
		_ = w.Flush()
		return
	}
	_ = body

	// Send SERVER_READY (no auth required, dev mode)
	srvReadyBody := make([]byte, 0, 16)
	srvReadyBody = binary.LittleEndian.AppendUint32(srvReadyBody, 0x000A0000) // v10.0.0
	srvReadyBody = binary.LittleEndian.AppendUint32(srvReadyBody, 0x0000001F) // caps: dev+stream+copy+ext+vector
	srvReadyBody = append(srvReadyBody, 0)                                    // auth_required=0
	srvReadyBody = binary.LittleEndian.AppendUint32(srvReadyBody, 16)         // nonce_len
	srvReadyBody = append(srvReadyBody, make([]byte, 16)...)                  // nonce
	if err := writeFrame(w, seq, opServerReady, 0, srvReadyBody); err != nil {
		return
	}
	// Send AUTH_OK with empty session_token
	authOKBody := make([]byte, 0, 24)
	authOKBody = binary.LittleEndian.AppendUint64(authOKBody, 0)                          // session_token
	authOKBody = binary.LittleEndian.AppendUint64(authOKBody, 0xFFFFFFFFFFFFFFFF)         // expires_at
	authOKBody = binary.LittleEndian.AppendUint32(authOKBody, 0)                          // server_final len
	if err := writeFrame(w, 0, opAuthOK, 0, authOKBody); err != nil {
		return
	}
	if err := w.Flush(); err != nil {
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		conn.SetDeadline(time.Now().Add(30 * time.Second))
		seq, op, flags, body, err := readFrame(r)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return
			}
			log.Printf("read frame: %v", err)
			return
		}
		_ = flags
		switch op {
		case opQuery:
			handleQuery(w, seq, body)
		case opPing:
			// body: u64 nonce
			if err := writeFrame(w, seq, opPong, 0, body[:8]); err != nil {
				return
			}
			_ = w.Flush()
		case opClose:
			return
		default:
			_ = writeFrame(w, seq, opError, 0, errorBody("0A000",
				fmt.Sprintf("unsupported opcode 0x%02X", op), "", ""))
			_ = w.Flush()
		}
	}
}

func handleQuery(w *bufio.Writer, seq uint8, body []byte) {
	// QUERY body: u32 query_id, u32 vedaql_text_len, str text, u16 param_count, []byte params
	if len(body) < 8 {
		_ = writeFrame(w, seq, opError, 0, errorBody("42601", "QUERY body too short", "", ""))
		_ = w.Flush()
		return
	}
	tlen := binary.LittleEndian.Uint32(body[4:8])
	if len(body) < int(8+tlen) {
		_ = writeFrame(w, seq, opError, 0, errorBody("42601", "truncated VedaQL text", "", ""))
		_ = w.Flush()
		return
	}
	text := string(body[8 : 8+tlen])

	// Strip params
	off := 8 + int(tlen)
	_ = off
	// param_count is u16 at off
	// We ignore params — dev server doesn't process them.

	upper := strings.ToUpper(strings.TrimSpace(text))

	// Strip params
	_ = binary.LittleEndian.Uint16 // keep import live; not parsing params in dev server

	// Simple dispatch
	switch {
	case upper == "SELECT 1", upper == "SELECT 1;":
		respondSelectInt(w, seq, 1)
	case upper == "BEGIN", upper == "BEGIN;":
		respondCommand(w, seq, 1, 0) // in_txn
	case upper == "COMMIT", upper == "ROLLBACK":
		respondCommand(w, seq, 0, 0) // idle
	case strings.HasPrefix(upper, "CREATE TABLE"), strings.HasPrefix(upper, "DROP TABLE"):
		respondCommand(w, seq, 0, 0)
	case strings.HasPrefix(upper, "INSERT"), strings.HasPrefix(upper, "UPDATE"), strings.HasPrefix(upper, "DELETE"):
		respondRowsAffected(w, seq, 1)
	case strings.HasPrefix(upper, "SELECT"):
		// Try to extract a literal int: SELECT <n> AS <name>;
		n, ok := extractSelectLiteral(upper)
		if !ok {
			_ = writeFrame(w, seq, opError, 0, errorBody("42601", "unsupported VedaQL: "+text, "", ""))
			_ = w.Flush()
			return
		}
		respondSelectInt(w, seq, n)
	default:
		_ = writeFrame(w, seq, opError, 0, errorBody("42601", "unsupported VedaQL: "+text, "", ""))
		_ = w.Flush()
	}
}

func extractSelectLiteral(upper string) (int, bool) {
	// Very loose: SELECT <digits> ...
	rest := strings.TrimPrefix(upper, "SELECT")
	rest = strings.TrimSpace(rest)
	// drop trailing semicolon
	rest = strings.TrimSuffix(rest, ";")
	// split on space; first token should be the literal
	parts := strings.Fields(rest)
	if len(parts) == 0 {
		return 0, false
	}
	n := 0
	for _, ch := range parts[0] {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		n = n*10 + int(ch-'0')
	}
	return n, true
}

func respondSelectInt(w *bufio.Writer, seq uint8, n int) {
	// DATA_CHUNK: u32 chunk_id=1, u32 row_count=1, u16 col_count=1,
	//   column: u16 type_id=tInt4, u8 null_bitmap_byte_count=0, [no bitmap]
	//   1 row of T_INT4: 4 bytes LE
	dc := make([]byte, 0, 32)
	dc = binary.LittleEndian.AppendUint32(dc, 1) // chunk_id
	dc = binary.LittleEndian.AppendUint32(dc, 1) // row_count
	dc = binary.LittleEndian.AppendUint16(dc, 1) // col_count
	dc = binary.LittleEndian.AppendUint16(dc, tInt4)
	dc = append(dc, 0) // null_bitmap_byte_count = 0
	dc = binary.LittleEndian.AppendUint32(dc, uint32(int32(n)))
	_ = writeFrame(w, seq, opDataChunk, 0, dc)
	// ROWS_FINISHED: u64 rows_affected=1, u32 command_tag_len, str tag, u32 exec_time_us
	tag := "SELECT 1"
	rf := make([]byte, 0, 32)
	rf = binary.LittleEndian.AppendUint64(rf, 1)
	rf = binary.LittleEndian.AppendUint32(rf, uint32(len(tag)))
	rf = append(rf, tag...)
	rf = binary.LittleEndian.AppendUint32(rf, 0)
	_ = writeFrame(w, seq, opRowsFinished, 0, rf)
	// COMMAND_COMPLETE: u8 status=0
	_ = writeFrame(w, seq, opCommandComplete, 0, []byte{0})
	_ = w.Flush()
}

func respondCommand(w *bufio.Writer, seq uint8, status, _ uint8) {
	_ = writeFrame(w, seq, opCommandComplete, 0, []byte{status})
	_ = w.Flush()
}

func respondRowsAffected(w *bufio.Writer, seq uint8, n int) {
	tag := fmt.Sprintf("INSERT 0 %d", n)
	rf := make([]byte, 0, 32)
	rf = binary.LittleEndian.AppendUint64(rf, uint64(n))
	rf = binary.LittleEndian.AppendUint32(rf, uint32(len(tag)))
	rf = append(rf, tag...)
	rf = binary.LittleEndian.AppendUint32(rf, 0)
	_ = writeFrame(w, seq, opRowsFinished, 0, rf)
	_ = writeFrame(w, seq, opCommandComplete, 0, []byte{0})
	_ = w.Flush()
}

func errorBody(sqlstate, msg, detail, hint string) []byte {
	b := make([]byte, 0, 64)
	// sqlstate is fixed 5 bytes (no length prefix)
	if len(sqlstate) != 5 {
		sqlstate = "0A000"
	}
	b = append(b, []byte(sqlstate)...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(msg)))
	b = append(b, msg...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(detail)))
	b = append(b, detail...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(hint)))
	b = append(b, hint...)
	b = binary.LittleEndian.AppendUint32(b, 0) // position
	return b
}

// ─── Wire I/O ─────────────────────────────────────────────────────────

func readFrame(r *bufio.Reader) (seq uint8, op uint8, flags uint8, body []byte, err error) {
	hdr := make([]byte, 8)
	if _, err = io.ReadFull(r, hdr); err != nil {
		return
	}
	if string(hdr[0:3]) != magicVDB {
		err = fmt.Errorf("vbp_dev: bad magic %q", hdr[0:3])
		return
	}
	plen := binary.LittleEndian.Uint32(hdr[3:7])
	seq = hdr[7]
	if plen < 2 {
		err = fmt.Errorf("vbp_dev: payload_length < 2 (%d)", plen)
		return
	}
	body = make([]byte, plen)
	if _, err = io.ReadFull(r, body); err != nil {
		return
	}
	op, flags = body[0], body[1]
	body = body[2:]
	return
}

func writeFrame(w *bufio.Writer, seq uint8, op uint8, flags uint8, body []byte) error {
	hdr := make([]byte, 8)
	copy(hdr[0:3], []byte(magicVDB))
	binary.LittleEndian.PutUint32(hdr[3:7], uint32(len(body)+2))
	hdr[7] = seq
	if _, err := w.Write(hdr); err != nil {
		return err
	}
	if err := w.WriteByte(op); err != nil {
		return err
	}
	if err := w.WriteByte(flags); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	return nil
}
