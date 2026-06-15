// VedaDB .NET SDK — VBP wire layer
//
// Thread-safe VBP request multiplexer over a single TCP socket.
// One seq-id (1 byte, wraps at 256) per in-flight request. Multiple threads
// may issue concurrent calls.
//
// IMPORTANT: "First terminal frame wins" — when the server emits two terminal
// frames in one TCP flush (e.g. SERVER_READY + AUTH_OK in dev mode), the
// multiplexer releases the latch on the first terminal frame and ignores
// subsequent terminal frames for the same in-flight request.

using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace VedaDB.Wire.Vbp
{
    public sealed class VBPMultiplexer : IDisposable
    {
        private readonly TcpClient? _client;
        private readonly Stream? _injectedIn;
        private readonly Stream? _injectedOut;
        private readonly Stream _in;
        private readonly Stream _out;
        private readonly CancellationTokenSource _closingCts = new CancellationTokenSource();
        private readonly Task _readerTask;
        private readonly object _seqLock = new object();
        private byte _nextSeq = 0;
        private readonly ConcurrentDictionary<byte, Inflight> _inflight = new ConcurrentDictionary<byte, Inflight>();

        public VBPMultiplexer(string host, int port, int timeoutMs)
        {
            _client = new TcpClient { NoDelay = true };
            _client.Connect(host, port);
            _client.ReceiveTimeout = timeoutMs;
            _client.SendTimeout = timeoutMs;
            _in = _client.GetStream();
            _out = _client.GetStream();
            _readerTask = Task.Run(ReadLoop);
        }

        /// <summary>Test-only constructor: inject pre-connected streams.</summary>
        public VBPMultiplexer(Stream inStream, Stream outStream)
        {
            _client = null;
            _injectedIn = inStream;
            _injectedOut = outStream;
            _in = inStream;
            _out = outStream;
            _readerTask = Task.Run(ReadLoop);
        }

        /// <summary>Send a request and wait for the reply. Uses default 30s timeout.</summary>
        public VBPFrame Call(byte op, byte[] body) => Call(op, body, 0, 30_000);

        public VBPFrame Call(byte op, byte[] body, byte flags, int timeoutMs)
        {
            byte seq;
            Inflight inf;
            lock (_seqLock)
            {
                int tries = 0;
                do
                {
                    seq = _nextSeq;
                    _nextSeq = (byte)((_nextSeq + 1) & 0xFF);
                    tries++;
                } while (_inflight.ContainsKey(seq) && tries <= 256);
                if (_inflight.ContainsKey(seq))
                    throw new VBPProtocolException(VBPProtocolError.SeqExhausted, "all 256 sequence ids in flight");
                inf = new Inflight();
                _inflight[seq] = inf;
            }
            try
            {
                lock (_out)
                {
                    var encoded = new VBPFrame(seq, op, flags, body).Encode();
                    _out.Write(encoded, 0, encoded.Length);
                    _out.Flush();
                }
            }
            catch (Exception e)
            {
                _inflight.TryRemove(seq, out _);
                Close();
                throw new VBPConnectionClosedException("send failed: " + e.Message, e);
            }
            try
            {
                if (!inf.Latch.Wait(timeoutMs))
                {
                    _inflight.TryRemove(seq, out _);
                    throw new VBPProtocolException(VBPProtocolError.Timeout, $"timeout waiting for seq={seq}");
                }
            }
            catch (ThreadInterruptedException)
            {
                Thread.CurrentThread.Interrupt();
                _inflight.TryRemove(seq, out _);
                throw new VBPProtocolException(VBPProtocolError.Interrupted, $"interrupted waiting for seq={seq}");
            }
            var reply = inf.Reply;
            _inflight.TryRemove(seq, out _);
            if (reply == null)
                throw new VBPConnectionClosedException("connection closed mid-call");
            if (reply.Op == VBPOpcodes.Error)
            {
                var err = VBPTypeCodec.ParseErrorBody(reply.Body);
                throw new VBPErrorException(err.SqlState, err.Message, err.Detail, err.Hint);
            }
            return reply;
        }

        private void ReadLoop()
        {
            try
            {
                while (!_closingCts.IsCancellationRequested)
                {
                    var f = ReadOne();
                    if (f == null) break;
                    if (_inflight.TryGetValue(f.Seq, out var inf))
                    {
                        // "First terminal wins": only count down + set reply once
                        // so unsolicited follow-up frames (e.g. AUTH_OK after
                        // SERVER_READY in dev mode) don't overwrite.
                        if (VBPOpcodes.IsTerminal(f.Op))
                        {
                            if (inf.Latch.CurrentCount > 0)
                            {
                                inf.Reply = f;
                                inf.Latch.Signal();
                            }
                        }
                        // Non-terminal streaming frames (DATA_CHUNK) are ignored
                        // for v1 POC — query returns the FIRST terminal frame.
                    }
                }
            }
            catch
            {
                // Connection lost — release all waiters.
            }
            finally
            {
                foreach (var kv in _inflight)
                {
                    kv.Value.Latch.Signal();
                }
            }
        }

        private VBPFrame? ReadOne()
        {
            try
            {
                var hdr = new byte[VBPFrame.HdrLen];
                ReadFully(hdr, 0, hdr.Length);
                if (hdr[0] != VBPFrame.Magic[0] || hdr[1] != VBPFrame.Magic[1] || hdr[2] != VBPFrame.Magic[2])
                    throw new VBPBadMagicException("bad magic in response");
                int pl = BitConverter.ToInt32(hdr, 3); // LE
                if (pl < VBPFrame.OpFlagsLen) throw new VBPTruncatedException("payload too short: " + pl);
                if (pl > VBPFrame.MaxFrameLen) throw new VBPOversizeException("payload too large: " + pl);
                byte seq = hdr[7];
                var opflags = new byte[VBPFrame.OpFlagsLen];
                ReadFully(opflags, 0, opflags.Length);
                byte op = opflags[0];
                byte flags = opflags[1];
                int bodyLen = pl - VBPFrame.OpFlagsLen;
                var body = new byte[bodyLen];
                if (bodyLen > 0) ReadFully(body, 0, bodyLen);
                return new VBPFrame(seq, op, flags, body);
            }
            catch (Exception e) when (e is IOException || e is VBPProtocolException)
            {
                if (e is VBPProtocolException) throw;
                return null;
            }
        }

        private void ReadFully(byte[] buf, int offset, int len)
        {
            int off = offset;
            while (off < offset + len)
            {
                int n = _in.Read(buf, off, offset + len - off);
                if (n < 0) throw new IOException("EOF");
                off += n;
            }
        }

        public void Close()
        {
            if (_closingCts.IsCancellationRequested) return;
            _closingCts.Cancel();
            try { _client?.Close(); } catch { }
            try { _injectedIn?.Dispose(); } catch { }
            try { _injectedOut?.Dispose(); } catch { }
            foreach (var kv in _inflight)
            {
                kv.Value.Latch.Signal();
            }
        }

        public void Dispose()
        {
            Close();
            try { _readerTask.Wait(1000); } catch { }
            _closingCts.Dispose();
        }

        public bool IsClosed => _closingCts.IsCancellationRequested;

        private sealed class Inflight
        {
            public CountdownLatch Latch { get; } = new CountdownLatch(1);
            public VBPFrame? Reply { get; set; }
        }

        /// <summary>Minimal CountDownLatch equivalent for .NET.</summary>
        private sealed class CountdownLatch
        {
            private int _count;
            public CountdownLatch(int initial) { _count = initial; }
            public int CurrentCount => Volatile.Read(ref _count);
            public void Signal() => Interlocked.Decrement(ref _count);
            public bool Wait(int timeoutMs)
            {
                int elapsed = 0;
                while (Volatile.Read(ref _count) > 0)
                {
                    if (elapsed >= timeoutMs) return false;
                    Thread.Sleep(1);
                    elapsed++;
                }
                return true;
            }
        }
    }
}
