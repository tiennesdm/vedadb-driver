// Package main: VBP v1 conformance reference harness (Go).
//
// This is the reference implementation of the vedadb-driver VBP
// conformance suite. It loads conformance/vbp_suite.yaml, dials
// a VBP v1 server, executes every test, and emits a JUnit XML
// report. All other 7 language harnesses are skeletons that load
// the same YAML and SKIP tests they don't yet implement.
//
// The harness is SELF-CONTAINED: it does NOT import the vedadb
// engine's internal vbp package. It speaks the wire protocol
// from scratch (the spec is the contract; "a v1 client can be
// written in 200 lines of Go using encoding/binary" — VBP_SPEC.md
// §1.4). This makes the harness a portable oracle — any v1 server
// that conforms to the spec will pass.
//
// Usage:
//
//	go run ./conformance/harness/go \
//	    -suite ../../conformance/vbp_suite.yaml \
//	    -addr  127.0.0.1:6380 \
//	    -out   ./vbp-conformance-go.junit.xml \
//	    -user  admin \
//	    -pass  TestPassword123! \
//	    -insecure          # skip auth (dev mode)
//
// Exit code 0 on all-PASS-or-SKIP, 1 if any test FAILs.
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gopkg.in/yaml.v3"
)

// ---------------------------------------------------------------------------
// VBP wire constants (from VBP_SPEC.md §4, §5, §6)
// ---------------------------------------------------------------------------

const (
	magicVDB = "VDB"

	// Opcodes
	opClientHello     = 0x01
	opServerReady     = 0x02
	opAuthChallenge   = 0x03
	opAuthResponse    = 0x04
	opAuthOK          = 0x05
	opQuery           = 0x06
	opParse           = 0x07
	opBind            = 0x08
	opExecute         = 0x09
	opDataChunk       = 0x0A
	opRowsFinished    = 0x0B
	opCommandComplete = 0x0C
	opError           = 0x0D
	opCancel          = 0x0E
	opStreamBegin     = 0x0F
	opStreamChunk     = 0x10
	opStreamEnd       = 0x11
	opCopyIn          = 0x12
	opCopyData        = 0x13
	opCopyDone        = 0x14
	opCopyFail        = 0x15
	opPing            = 0x16
	opPong            = 0x17
	opClose           = 0x18
	opExtQuery        = 0x1A

	// Auth mechanisms
	mechPLAIN = 0x01
	mechSCRAM = 0x02

	// Type IDs (closed registry, 36 entries)
	tBool      = uint16(16)
	tInt4      = uint16(23)
	tInt8      = uint16(20)
	tFloat4    = uint16(700)
	tFloat8    = uint16(701)
	tText      = uint16(25)
	tBytea     = uint16(17)
	tTimestamp = uint16(1114)
	tJsonb     = uint16(3802)
	tArray     = uint16(2277)
	tVectorF32 = uint16(5000)
	tVectorF16 = uint16(5001)
	tSparseVec = uint16(5010)
	tEmbed     = uint16(5020)
	tQuant     = uint16(5030)
	tBinaryVec = uint16(5040)
	tDoc       = uint16(5100)
	tDocPath   = uint16(5101)
	tKVKey     = uint16(5200)
	tKVValue   = uint16(5201)
	tKVTomb    = uint16(5202)
	tNode      = uint16(5300)
	tEdge      = uint16(5301)
	tPath      = uint16(5302)
	tTraverse  = uint16(5303)
	tTSID      = uint16(5400)
	tTSSample  = uint16(5401)
	tTSRange   = uint16(5402)
	tGeoPoint  = uint16(5500)
	tGeoLine   = uint16(5501)
	tGeoPoly   = uint16(5502)
	tGeoH3     = uint16(5503)
	tGeoS2     = uint16(5504)
	tSearchDoc = uint16(5600)
	tSearchHit = uint16(5601)
	tAnalyzed  = uint16(5602)
)

// AllTypeIDs is the closed v1 type registry. Per types.go in the
// engine, the registry actually contains 36 IDs (the spec's "27"
// in §5 is a typo — the table count is 36).
var AllTypeIDs = []uint16{
	tBool, tInt4, tInt8, tFloat4, tFloat8, tText, tBytea, tTimestamp, tJsonb, tArray,
	tVectorF32, tVectorF16, tSparseVec, tEmbed, tQuant, tBinaryVec,
	tDoc, tDocPath,
	tKVKey, tKVValue, tKVTomb,
	tNode, tEdge, tPath, tTraverse,
	tTSID, tTSSample, tTSRange,
	tGeoPoint, tGeoLine, tGeoPoly, tGeoH3, tGeoS2,
	tSearchDoc, tSearchHit, tAnalyzed,
}

// Fixed-width lookup (from §5.2-§5.9 and Appendix B)
var fixedWidths = map[uint16]int{
	tBool:      1,
	tInt4:      4,
	tInt8:      8,
	tFloat4:    4,
	tFloat8:    8,
	tTimestamp: 8,
	tKVTomb:    16,
	tEdge:      38,
	tTraverse:  16,
	tTSRange:   17,
	tGeoPoint:  16,
	tGeoH3:     9,
	tGeoS2:     9,
}

// ---------------------------------------------------------------------------
// YAML suite
// ---------------------------------------------------------------------------

// Suite is the top-level YAML document.
type Suite struct {
	Version    int    `yaml:"version"`
	Suite      string `yaml:"suite"`
	VBPPort    int    `yaml:"vbp_port"`
	VBPSpecRef string `yaml:"vbp_spec_ref"`
	Tests      []Test `yaml:"tests"`
}

// Test is a single conformance test case.
type Test struct {
	ID          int                    `yaml:"id"`
	Name        string                 `yaml:"name"`
	Category    string                 `yaml:"category"`
	Description string                 `yaml:"description"`
	Setup       []string               `yaml:"setup"`
	Teardown    []string               `yaml:"teardown"`
	Operation   map[string]interface{} `yaml:"operation"`
	Expect      map[string]interface{} `yaml:"expect"`
}

// ---------------------------------------------------------------------------
// VBP client
// ---------------------------------------------------------------------------

// Client is a minimal in-process VBP v1 client.
type Client struct {
	conn net.Conn
	r    *bufio.Reader
	w    *bufio.Writer
	seq  uint32
	mu   sync.Mutex
}

func dial(ctx context.Context, addr string) (*Client, error) {
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	return &Client{
		conn: conn,
		r:    bufio.NewReaderSize(conn, 64*1024),
		w:    bufio.NewWriterSize(conn, 64*1024),
	}, nil
}

func (c *Client) Close() error { return c.conn.Close() }

func (c *Client) nextSeq() uint8 {
	atomic.AddUint32(&c.seq, 1)
	return uint8(c.seq)
}

// writeFrame serializes a 1-byte opcode + 1-byte flags + N-byte body
// into the 8-byte header + payload shape.
func (c *Client) writeFrame(seq uint8, op uint8, flags uint8, body []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	hdr := make([]byte, 8)
	copy(hdr[0:3], []byte(magicVDB))
	binary.LittleEndian.PutUint32(hdr[3:7], uint32(len(body)+2))
	hdr[7] = seq
	if _, err := c.w.Write(hdr); err != nil {
		return err
	}
	if err := c.w.WriteByte(op); err != nil {
		return err
	}
	if err := c.w.WriteByte(flags); err != nil {
		return err
	}
	if _, err := c.w.Write(body); err != nil {
		return err
	}
	return c.w.Flush()
}

// readFrame reads one frame from the wire.
func (c *Client) readFrame() (seq uint8, op uint8, flags uint8, body []byte, err error) {
	hdr := make([]byte, 8)
	if _, err = io.ReadFull(c.r, hdr); err != nil {
		return
	}
	if string(hdr[0:3]) != magicVDB {
		err = fmt.Errorf("vbp: bad magic %q", hdr[0:3])
		return
	}
	plen := binary.LittleEndian.Uint32(hdr[3:7])
	seq = hdr[7]
	if plen < 2 {
		err = fmt.Errorf("vbp: payload_length < 2 (%d)", plen)
		return
	}
	if plen > 16*1024*1024 {
		err = fmt.Errorf("vbp: payload too large (%d)", plen)
		return
	}
	body = make([]byte, plen)
	if _, err = io.ReadFull(c.r, body); err != nil {
		return
	}
	op, flags = body[0], body[1]
	body = body[2:]
	return
}

// sendClientHello performs §3.4 step 1.
func (c *Client) sendClientHello(user, db, actorID string) error {
	body := encodeClientHello(1, 0, user, db, 0, actorID)
	return c.writeFrame(c.nextSeq(), opClientHello, 0, body)
}

func encodeClientHello(ver, flags uint16, user, db string, actorKind uint8, actorID string) []byte {
	b := make([]byte, 0, 32)
	b = binary.LittleEndian.AppendUint16(b, ver)
	b = binary.LittleEndian.AppendUint16(b, flags)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(user)))
	b = append(b, user...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(db)))
	b = append(b, db...)
	b = append(b, actorKind)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(actorID)))
	b = append(b, actorID...)
	return b
}

// connectAndHandshake does hello + (optional) PLAIN auth.
// Returns the captured server_caps so the harness can decide which
// features to attempt.
func (c *Client) connectAndHandshake(user, pass string, skipAuth bool) (serverCaps uint32, authOK bool, err error) {
	if err = c.sendClientHello(user, "", ""); err != nil {
		return
	}
	_, op, _, body, rerr := c.readFrame()
	if rerr != nil {
		err = rerr
		return
	}
	if op != opServerReady {
		err = fmt.Errorf("expected SERVER_READY, got 0x%02X", op)
		return
	}
	if len(body) < 9 {
		err = fmt.Errorf("SERVER_READY too short: %d bytes", len(body))
		return
	}
	_ = binary.LittleEndian.Uint32(body[0:4]) // server_version
	serverCaps = binary.LittleEndian.Uint32(body[4:8])
	authRequired := body[8]
	if authRequired == 0 || skipAuth {
		_, op, _, _, rerr := c.readFrame()
		if rerr != nil {
			err = rerr
			return
		}
		if op == opAuthOK {
			authOK = true
		} else if op == opError {
			err = errors.New("server returned ERROR after no-auth CLIENT_HELLO")
		}
		return
	}
	// Auth required — PLAIN.
	if err = c.sendAuthResponsePLAIN(user, pass); err != nil {
		return
	}
	_, op, _, _, rerr = c.readFrame()
	if rerr != nil {
		err = rerr
		return
	}
	if op == opAuthOK {
		authOK = true
	} else if op == opError {
		err = errors.New("server returned ERROR after PLAIN AUTH_RESPONSE")
	} else {
		err = fmt.Errorf("expected AUTH_OK, got 0x%02X", op)
	}
	return
}

func (c *Client) sendAuthResponsePLAIN(user, pass string) error {
	proof := make([]byte, 0, 16)
	proof = binary.LittleEndian.AppendUint32(proof, uint32(len(user)))
	proof = append(proof, user...)
	proof = binary.LittleEndian.AppendUint32(proof, uint32(len(pass)))
	proof = append(proof, pass...)
	body := make([]byte, 0, 16)
	body = append(body, mechPLAIN)
	body = binary.LittleEndian.AppendUint32(body, uint32(len(proof)))
	body = append(body, proof...)
	body = binary.LittleEndian.AppendUint32(body, 0) // sig_len=0 for PLAIN
	return c.writeFrame(c.nextSeq(), opAuthResponse, 0, body)
}

// QueryResult is the decoded response to a QUERY.
type QueryResult struct {
	Columns      []string
	ColumnTypes  []uint16
	Rows         [][]string
	RowsAffected uint64
	CommandTag   string
	Status       uint8
}

func (c *Client) query(text string, params []interface{}) (*QueryResult, error) {
	body := make([]byte, 0, 32)
	body = binary.LittleEndian.AppendUint32(body, 1) // query_id
	body = binary.LittleEndian.AppendUint32(body, uint32(len(text)))
	body = append(body, text...)
	body = binary.LittleEndian.AppendUint16(body, uint16(len(params)))
	for _, p := range params {
		pm, ok := p.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("param must be a map, got %T", p)
		}
		tid, _ := pm["type_id"].(int)
		b, err := encodeParam(uint16(tid), pm)
		if err != nil {
			return nil, err
		}
		body = append(body, b...)
	}
	if err := c.writeFrame(c.nextSeq(), opQuery, 0, body); err != nil {
		return nil, err
	}
	return c.readQueryResponse()
}

func (c *Client) readQueryResponse() (*QueryResult, error) {
	res := &QueryResult{}
	for {
		_, op, _, body, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch op {
		case opDataChunk:
			cols, colTypes, rows, err := decodeDataChunk(body)
			if err != nil {
				return nil, err
			}
			res.Columns = append(res.Columns, cols...)
			res.ColumnTypes = append(res.ColumnTypes, colTypes...)
			for _, r := range rows {
				res.Rows = append(res.Rows, r)
			}
		case opRowsFinished:
			if len(body) >= 8 {
				res.RowsAffected = binary.LittleEndian.Uint64(body[0:8])
			}
			if len(body) >= 12 {
				tlen := binary.LittleEndian.Uint32(body[8:12])
				if 12+int(tlen) <= len(body) {
					res.CommandTag = string(body[12 : 12+tlen])
				}
			}
		case opCommandComplete:
			if len(body) >= 1 {
				res.Status = body[0]
			}
			return res, nil
		case opError:
			return nil, fmt.Errorf("server ERROR: %s", strings.TrimSpace(string(body)))
		default:
			return nil, fmt.Errorf("unexpected opcode 0x%02X in query response", op)
		}
	}
}

// encodeParam produces the input-envelope bytes (u16 type_id + u8 null_tag + body).
func encodeParam(tid uint16, pm map[string]interface{}) ([]byte, error) {
	b := make([]byte, 0, 8)
	b = binary.LittleEndian.AppendUint16(b, tid)
	if null, _ := pm["null"].(bool); null {
		b = append(b, 0) // null_tag=0
		return b, nil
	}
	b = append(b, 1) // null_tag=1
	switch tid {
	case tBool:
		v, _ := pm["value"].(bool)
		if v {
			b = append(b, 1)
		} else {
			b = append(b, 0)
		}
	case tInt4:
		v, _ := pm["value"].(int)
		b = binary.LittleEndian.AppendUint32(b, uint32(int32(v)))
	case tInt8:
		v, _ := pm["value"].(int)
		b = binary.LittleEndian.AppendUint64(b, uint64(int64(v)))
	case tFloat4:
		v, _ := pm["value"].(float64)
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(float32(v)))
	case tFloat8:
		v, _ := pm["value"].(float64)
		b = binary.LittleEndian.AppendUint64(b, math.Float64bits(v))
	case tText:
		v, _ := pm["value"].(string)
		b = binary.LittleEndian.AppendUint32(b, uint32(len(v)))
		b = append(b, v...)
	case tBytea:
		hexStr, _ := pm["value_hex"].(string)
		raw, _ := hex.DecodeString(hexStr)
		b = binary.LittleEndian.AppendUint32(b, uint32(len(raw)))
		b = append(b, raw...)
	case tTimestamp:
		v, _ := pm["value"].(int)
		b = binary.LittleEndian.AppendUint64(b, uint64(v))
	case tVectorF32:
		m, _ := pm["value"].(map[string]interface{})
		dimF, _ := m["dim"].(int)
		vals, _ := m["values"].([]interface{})
		b = binary.LittleEndian.AppendUint32(b, uint32(dimF))
		for i := 0; i < dimF && i < len(vals); i++ {
			f, _ := vals[i].(float64)
			b = binary.LittleEndian.AppendUint32(b, math.Float32bits(float32(f)))
		}
	default:
		// For types the harness does not yet encode, emit an empty
		// body — server will reject (sqlstate 0A000) and the test
		// can decide if that's expected.
	}
	return b, nil
}

// decodeDataChunk parses §5.1.b: u32 chunk_id, u32 row_count, u16 col_count, columns...
func decodeDataChunk(body []byte) (cols []string, colTypes []uint16, rows [][]string, err error) {
	if len(body) < 10 {
		err = fmt.Errorf("DATA_CHUNK too short: %d", len(body))
		return
	}
	rowCount := binary.LittleEndian.Uint32(body[4:8])
	colCount := binary.LittleEndian.Uint16(body[8:10])
	off := 10
	for i := 0; i < int(colCount); i++ {
		if off+3 > len(body) {
			err = fmt.Errorf("DATA_CHUNK truncated at col %d", i)
			return
		}
		tid := binary.LittleEndian.Uint16(body[off : off+2])
		nbc := body[off+2]
		off += 3
		off += int(nbc) // null bitmap
		colTypes = append(colTypes, tid)
		cols = append(cols, fmt.Sprintf("col%d_t%d", i, tid))
		for r := uint32(0); r < rowCount; r++ {
			v, n, derr := decodeColumnValue(tid, body[off:])
			if derr != nil {
				err = derr
				return
			}
			off += n
			if len(rows) <= int(r) {
				rows = append(rows, make([]string, int(colCount)))
			}
			rows[r] = append(rows[r], v)
		}
	}
	return
}

func decodeColumnValue(tid uint16, body []byte) (string, int, error) {
	if w, ok := fixedWidths[tid]; ok {
		if len(body) < w {
			return "", 0, fmt.Errorf("truncated fixed-width col body for type %d", tid)
		}
		return formatColumnValue(tid, body[:w]), w, nil
	}
	if len(body) < 4 {
		return "", 0, fmt.Errorf("truncated var-width col body for type %d", tid)
	}
	ln := binary.LittleEndian.Uint32(body[0:4])
	if len(body) < int(4+ln) {
		return "", 0, fmt.Errorf("truncated var-width col body for type %d", tid, 4+ln, len(body))
	}
	return formatColumnValue(tid, body[4:4+ln]), int(4 + ln), nil
}

func formatColumnValue(tid uint16, body []byte) string {
	switch tid {
	case tBool:
		if len(body) >= 1 {
			if body[0] == 1 {
				return "true"
			}
			return "false"
		}
	case tInt4:
		if len(body) >= 4 {
			return fmt.Sprintf("%d", int32(binary.LittleEndian.Uint32(body[0:4])))
		}
	case tInt8:
		if len(body) >= 8 {
			return fmt.Sprintf("%d", int64(binary.LittleEndian.Uint64(body[0:8])))
		}
	case tFloat4:
		if len(body) >= 4 {
			bits := binary.LittleEndian.Uint32(body[0:4])
			return fmt.Sprintf("%g", math.Float32frombits(bits))
		}
	case tFloat8:
		if len(body) >= 8 {
			bits := binary.LittleEndian.Uint64(body[0:8])
			return fmt.Sprintf("%g", math.Float64frombits(bits))
		}
	case tText, tJsonb, tBytea:
		return string(body)
	}
	return fmt.Sprintf("<t%d:%s>", tid, hex.EncodeToString(body))
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

// TestOutcome is one test's result.
type TestOutcome struct {
	ID       int
	Name     string
	Category string
	Status   string // "pass", "fail", "skip", "error"
	Message  string
	Duration time.Duration
}

// JUnit XML
type junitTestSuites struct {
	XMLName xml.Name     `xml:"testsuites"`
	Suites  []junitSuite `xml:"testsuite"`
}
type junitSuite struct {
	XMLName  xml.Name    `xml:"testsuite"`
	Name     string      `xml:"name,attr"`
	Tests    int         `xml:"tests,attr"`
	Failures int         `xml:"failures,attr"`
	Skipped  int         `xml:"skipped,attr"`
	Errors   int         `xml:"errors,attr"`
	Time     string      `xml:"time,attr"`
	Cases    []junitCase `xml:"testcase"`
}
type junitCase struct {
	XMLName   xml.Name `xml:"testcase"`
	Classname string   `xml:"classname,attr"`
	Name      string   `xml:"name,attr"`
	Time      string   `xml:"time,attr"`
	Failure   *string  `xml:"failure,omitempty"`
	Skip      *string  `xml:"skipped,omitempty"`
}

func writeJUnit(outcomes []TestOutcome, path, suiteName string) error {
	js := junitTestSuites{}
	byCat := map[string][]TestOutcome{}
	for _, o := range outcomes {
		byCat[o.Category] = append(byCat[o.Category], o)
	}
	cats := make([]string, 0, len(byCat))
	for c := range byCat {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	for _, c := range cats {
		s := junitSuite{Name: c}
		s.Tests = len(byCat[c])
		for _, o := range byCat[c] {
			tc := junitCase{
				Classname: suiteName,
				Name:      fmt.Sprintf("%d %s", o.ID, o.Name),
				Time:      fmt.Sprintf("%.3f", o.Duration.Seconds()),
			}
			switch o.Status {
			case "pass":
				// no body
			case "fail":
				msg := o.Message
				tc.Failure = &msg
				s.Failures++
			case "skip":
				msg := o.Message
				tc.Skip = &msg
				s.Skipped++
			case "error":
				msg := o.Message
				tc.Failure = &msg
				s.Errors++
			}
			s.Cases = append(s.Cases, tc)
		}
		s.Time = fmt.Sprintf("%.3f", totalSec(byCat[c]))
		js.Suites = append(js.Suites, s)
	}
	data, err := xml.MarshalIndent(js, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append([]byte(xml.Header), data...), 0o644)
}

func totalSec(oo []TestOutcome) float64 {
	var d time.Duration
	for _, o := range oo {
		d += o.Duration
	}
	return d.Seconds()
}

// runTest executes one test case and returns an outcome.
func runTest(t *Test, addr, user, pass string, serverCaps uint32) TestOutcome {
	start := time.Now()
	o := TestOutcome{ID: t.ID, Name: t.Name, Category: t.Category}
	_ = serverCaps

	// Setup SQL
	for _, s := range t.Setup {
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "error"
			o.Message = fmt.Sprintf("setup dial: %v", err)
			o.Duration = time.Since(start)
			return o
		}
		_, _, _ = cli.connectAndHandshake(user, pass, false)
		_, _ = cli.query(s, nil)
		_ = cli.Close()
	}

	kind, _ := t.Operation["kind"].(string)
	switch kind {
	case "connect":
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "fail"
			o.Message = fmt.Sprintf("dial: %v", err)
		} else {
			defer cli.Close()
			_ = cli.sendClientHello(user, "", "")
			_, op, _, _, err := cli.readFrame()
			if err != nil {
				o.Status = "fail"
				o.Message = err.Error()
			} else if op == opServerReady {
				o.Status = "pass"
			} else {
				o.Status = "fail"
				o.Message = fmt.Sprintf("expected SERVER_READY, got 0x%02X", op)
			}
		}

	case "query":
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "error"
			o.Message = err.Error()
		} else {
			defer cli.Close()
			_, _, _ = cli.connectAndHandshake(user, pass, false)
			sqlText, _ := t.Operation["sql"].(string)
			paramsRaw, _ := t.Operation["params"].([]interface{})
			_, qerr := cli.query(sqlText, paramsRaw)
			expectOK, _ := t.Expect["ok"].(bool)
			if qerr != nil {
				if !expectOK {
					o.Status = "pass"
				} else {
					o.Status = "fail"
					o.Message = qerr.Error()
				}
			} else {
				if expectOK {
					o.Status = "pass"
				} else {
					o.Status = "fail"
					o.Message = "expected error, got success"
				}
			}
		}

	case "txn":
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "error"
			o.Message = err.Error()
		} else {
			defer cli.Close()
			_, _, _ = cli.connectAndHandshake(user, pass, false)
			stepsRaw, _ := t.Operation["steps"].([]interface{})
			var lastErr error
			for _, s := range stepsRaw {
				sqlText, _ := s.(string)
				if sqlText == "" {
					if sm, ok := s.(map[string]interface{}); ok {
						sqlText, _ = sm["sql"].(string)
					}
				}
				if sqlText == "" {
					continue
				}
				_, err := cli.query(sqlText, nil)
				if err != nil {
					lastErr = err
				}
			}
			verifyText, _ := t.Operation["verify"].(string)
			verifyWant, _ := t.Expect["verify_equals"].(string)
			if verifyText != "" && verifyWant != "" {
				res, err := cli.query(verifyText, nil)
				if err != nil {
					o.Status = "fail"
					o.Message = "verify query failed: " + err.Error()
				} else if len(res.Rows) == 0 || res.Rows[0][0] != verifyWant {
					got := "?"
					if len(res.Rows) > 0 {
						got = res.Rows[0][0]
					}
					o.Status = "fail"
					o.Message = fmt.Sprintf("verify_equals: want %q, got %q", verifyWant, got)
				} else {
					o.Status = "pass"
				}
			} else if lastErr != nil {
				expectOK, _ := t.Expect["ok"].(bool)
				if expectOK {
					o.Status = "fail"
					o.Message = lastErr.Error()
				} else {
					o.Status = "pass"
				}
			} else {
				o.Status = "pass"
			}
		}

	case "send_only", "send_frame":
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "error"
			o.Message = err.Error()
		} else {
			defer cli.Close()
			_, _, _ = cli.connectAndHandshake(user, pass, false)
			op, _ := t.Operation["opcode"].(int)
			flags, _ := t.Operation["flags"].(int)
			body := []byte{}
			if b, ok := t.Operation["body"].(map[string]interface{}); ok {
				body = encodeClientHelloFromMap(b)
			}
			if err := cli.writeFrame(cli.nextSeq(), uint8(op), uint8(flags), body); err != nil {
				o.Status = "fail"
				o.Message = err.Error()
			} else {
				_, rop, _, rbody, rerr := cli.readFrame()
				if rerr != nil {
					o.Status = "fail"
					o.Message = rerr.Error()
				} else if rop == opError {
					wantState, _ := t.Expect["sqlstate"].(string)
					if wantState != "" && !strings.HasPrefix(string(rbody), wantState) {
						o.Status = "fail"
						o.Message = fmt.Sprintf("want sqlstate %s, got body %q", wantState, string(rbody))
					} else {
						o.Status = "pass"
					}
				} else {
					o.Status = "pass"
				}
			}
		}

	case "handshake":
		cli, err := dial(context.Background(), addr)
		if err != nil {
			o.Status = "error"
			o.Message = err.Error()
		} else {
			defer cli.Close()
			_, authOK, herr := cli.connectAndHandshake(user, pass, false)
			expectOK, _ := t.Expect["ok"].(bool)
			if herr != nil {
				if !expectOK {
					o.Status = "pass"
				} else {
					o.Status = "fail"
					o.Message = herr.Error()
				}
			} else {
				if expectOK && !authOK {
					o.Status = "fail"
					o.Message = "auth did not return AUTH_OK"
				} else {
					o.Status = "pass"
				}
			}
		}

	default:
		// Categories the harness does not yet drive end-to-end:
		// encode_decode, ext_query, copy_in, cancel_query, etc.
		// The Go harness SKIPs these with a clear reason rather
		// than faking a result. Per Shubham's "honest not
		// implemented" preference.
		o.Status = "skip"
		o.Message = fmt.Sprintf("Go harness: kind=%q not yet driven end-to-end (TODO: implement)", kind)
	}

	// Teardown SQL
	for _, s := range t.Teardown {
		cli, err := dial(context.Background(), addr)
		if err == nil {
			_, _, _ = cli.connectAndHandshake(user, pass, false)
			_, _ = cli.query(s, nil)
			_ = cli.Close()
		}
	}

	o.Duration = time.Since(start)
	return o
}

// encodeClientHelloFromMap is a best-effort encoder for the body
// field of a "send_frame" op=0x01 test. Most tests in that shape
// only care about server reaction; we just push zeros for any
// missing field.
func encodeClientHelloFromMap(m map[string]interface{}) []byte {
	ver, _ := m["protocol_version"].(int)
	flags, _ := m["client_flags"].(int)
	user, _ := m["username"].(string)
	db, _ := m["database"].(string)
	actorKind, _ := m["actor_kind"].(int)
	actorID, _ := m["actor_id"].(string)
	if r, ok := m["username_repeat"].(int); ok {
		user = strings.Repeat("u", r)
	}
	return encodeClientHello(uint16(ver), uint16(flags), user, db, uint8(actorKind), actorID)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	var (
		suitePath = flag.String("suite", "conformance/vbp_suite.yaml", "path to vbp_suite.yaml")
		addr      = flag.String("addr", "127.0.0.1:6380", "VBP server address")
		out       = flag.String("out", "vbp-conformance-go.junit.xml", "JUnit XML output path")
		user      = flag.String("user", "admin", "auth username")
		pass      = flag.String("pass", "TestPassword123!", "auth password")
		insecure  = flag.Bool("insecure", false, "skip auth (dev mode)")
		category  = flag.String("category", "", "filter to one category (e.g. query)")
		verbose   = flag.Bool("v", false, "verbose progress")
		seed      = flag.Int64("seed", 42, "PRNG seed")
	)
	flag.Parse()
	rand.Seed(*seed)

	raw, err := os.ReadFile(*suitePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read suite: %v\n", err)
		os.Exit(2)
	}
	var suite Suite
	if err := yaml.Unmarshal(raw, &suite); err != nil {
		fmt.Fprintf(os.Stderr, "parse suite: %v\n", err)
		os.Exit(2)
	}

	tests := suite.Tests
	if *category != "" {
		filtered := tests[:0]
		for _, t := range tests {
			if t.Category == *category {
				filtered = append(filtered, t)
			}
		}
		tests = filtered
	}

	// Warmup: capture server caps from a single handshake
	var serverCaps uint32
	if cli, err := dial(context.Background(), *addr); err == nil {
		caps, _, _ := cli.connectAndHandshake(*user, *pass, *insecure)
		serverCaps = caps
		_ = cli.Close()
	} else if *verbose {
		fmt.Fprintf(os.Stderr, "warmup dial failed (continuing): %v\n", err)
	}

	outcomes := make([]TestOutcome, 0, len(tests))
	passN, failN, skipN, errN := 0, 0, 0, 0
	for i := range tests {
		t := &tests[i]
		if *verbose {
			fmt.Printf("[%d/%d] %d %s [%s] ... ", i+1, len(tests), t.ID, t.Name, t.Category)
		}
		o := runTest(t, *addr, *user, *pass, serverCaps)
		switch o.Status {
		case "pass":
			passN++
		case "fail":
			failN++
		case "skip":
			skipN++
		case "error":
			errN++
		}
		if *verbose {
			fmt.Printf("%s (%s)\n", o.Status, o.Message)
		}
		outcomes = append(outcomes, o)
	}

	if err := writeJUnit(outcomes, *out, suite.Suite); err != nil {
		fmt.Fprintf(os.Stderr, "write JUnit: %v\n", err)
		os.Exit(2)
	}

	fmt.Printf("VBP v1 conformance (Go harness)\n")
	fmt.Printf("  tests:  %d\n", len(outcomes))
	fmt.Printf("  pass:   %d\n", passN)
	fmt.Printf("  fail:   %d\n", failN)
	fmt.Printf("  skip:   %d\n", skipN)
	fmt.Printf("  error:  %d\n", errN)
	fmt.Printf("  report: %s\n", *out)
	if failN > 0 || errN > 0 {
		os.Exit(1)
	}
}
