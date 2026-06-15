// VedaDB .NET SDK — VBP wire layer
//
// High-level async VBP client. Public API mirrors the Python POC:
//   new VBPConnection(host, port, user, password, db)
//   await ConnectAsync()
//   await ExecuteAsync(sql, args)
//   await PingAsync()
//   await CloseAsync()

using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace VedaDB.Wire.Vbp
{
    public sealed class VBPConnection : IAsyncDisposable, IDisposable
    {
        public const int DefaultVbpPort = 6380;
        public const int ProtocolVersion = 1;

        private readonly string _host;
        private readonly int _port;
        private readonly string _user;
        private readonly string _password;
        private readonly string _database;
        private readonly int _timeoutMs;
        private readonly string _authMechanism;

        private VBPMultiplexer? _mux;
        private int _serverVersion;
        private int _serverCaps;
        private long _sessionTokenLo;
        private long _sessionTokenHi;
        private int _nextQueryId = 1;

        public VBPConnection(string host, int port, string user, string password, string database)
            : this(host, port, user, password, database, 30, Environment.GetEnvironmentVariable("VEDADB_VBP_MECH"))
        {
        }

        public VBPConnection(string host, int port, string user, string password, string database,
                             int timeoutSeconds, string? authMechanism = null)
        {
            _host = host;
            _port = port;
            _user = user;
            _password = password;
            _database = database ?? "";
            _timeoutMs = timeoutSeconds * 1000;
            _authMechanism = string.IsNullOrEmpty(authMechanism)
                ? VBPOpcodes.AuthMechPlain
                : authMechanism.ToUpperInvariant();
        }

        public async Task<VBPConnection> ConnectAsync()
        {
            return await Task.Run(() => Connect());
        }

        public VBPConnection Connect()
        {
            try
            {
                _mux = new VBPMultiplexer(_host, _port, _timeoutMs);
            }
            catch (Exception e)
            {
                throw new VBPException(VBPOpcodes.SqlStateConnectionFailure, "connect failed: " + e.Message);
            }

            // CLIENT_HELLO
            var hello = VBPTypeCodec.ClientHelloBody(
                ProtocolVersion, 0, _user, _database, (byte)0, _user);
            var ready = _mux.Call(VBPOpcodes.ClientHello, hello);
            if (ready.Op != VBPOpcodes.ServerReady)
                throw new VBPErrorException(VBPOpcodes.SqlStateConnectionFailure,
                    "expected SERVER_READY, got " + VBPOpcodes.OpcodeName(ready.Op));
            var sr = VBPTypeCodec.ParseServerReady(ready.Body);
            _serverVersion = sr.ServerVersion;
            _serverCaps = sr.ServerCaps;

            if (sr.AuthRequired)
            {
                VBPFrame authResp;
                if (VBPOpcodes.AuthMechScramSha256.Equals(_authMechanism, StringComparison.Ordinal))
                {
                    authResp = PerformScramAuth(ready, sr);
                }
                else
                {
                    var plain = VBPAuth.PlainClientFirst(_user, _password);
                    authResp = _mux.Call(VBPOpcodes.AuthResponse, plain);
                }
                if (authResp.Op != VBPOpcodes.AuthOk)
                    throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed,
                        "auth failed: " + VBPOpcodes.OpcodeName(authResp.Op));
                var ok = VBPTypeCodec.ParseAuthOk(authResp.Body);
                _sessionTokenLo = ok.SessionTokenLo;
                _sessionTokenHi = ok.SessionTokenHi;
            }
            return this;
        }

        private VBPFrame PerformScramAuth(VBPFrame ready, VBPTypeCodec.ServerReadyParts sr)
        {
            // SCRAM-SHA-256 flow (only used when server actually challenges us;
            // vbp_dev_server uses PLAIN dev-mode auth by default).
            var nonceBytes = VBPAuth.GenerateNonce();
            var clientFirst = VBPAuth.ClientFirstMessage(_user, nonceBytes);
            var challenge = _mux!.Call(VBPOpcodes.AuthResponse,
                Encoding_UTF8.GetBytes("SCRAM-SHA-256 " + clientFirst));
            if (challenge.Op == VBPOpcodes.AuthOk) return challenge;
            if (challenge.Op != VBPOpcodes.AuthChallenge)
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed,
                    "expected AUTH_CHALLENGE, got " + VBPOpcodes.OpcodeName(challenge.Op));
            var serverFirst = Encoding_UTF8.GetString(challenge.Body);
            var state = new VBPAuth.ScramState(nonceBytes);
            var clientFinal = VBPAuth.ClientFinalMessage(state, _user, _password, serverFirst);
            var serverFinal = _mux.Call(VBPOpcodes.AuthResponse, Encoding_UTF8.GetBytes(clientFinal));
            if (serverFinal.Op == VBPOpcodes.AuthOk) return serverFinal;
            if (serverFinal.Op != VBPOpcodes.AuthChallenge)
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed,
                    "expected server-final AUTH_CHALLENGE, got " + VBPOpcodes.OpcodeName(serverFinal.Op));
            var sf = Encoding_UTF8.GetString(serverFinal.Body);
            VBPAuth.VerifyServerFinal(state, sf);
            // After verify, request a final AUTH_OK.
            var ok = _mux.Call(VBPOpcodes.AuthResponse, Array.Empty<byte>());
            if (ok.Op != VBPOpcodes.AuthOk)
                throw new VBPErrorException(VBPOpcodes.SqlStateAuthFailed,
                    "expected AUTH_OK after SCRAM, got " + VBPOpcodes.OpcodeName(ok.Op));
            return ok;
        }

        public Task<VBPResult> ExecuteAsync(string sql) => Task.Run(() => Execute(sql));

        public Task<VBPResult> ExecuteAsync(string sql, params object?[] args) =>
            Task.Run(() => Execute(sql, args));

        public VBPResult Execute(string sql) => Execute(sql, Array.Empty<object?>());

        public VBPResult Execute(string sql, params object?[] args)
        {
            return Execute(sql, (IList<object?>)args);
        }

        public VBPResult Execute(string sql, IList<object?> args)
        {
            if (_mux == null)
                throw new VBPException(VBPOpcodes.SqlStateConnectionFailure, "not connected");
            var envs = new List<byte[]>();
            if (args != null)
            {
                foreach (var p in args) envs.Add(EncodeParam(p));
            }
            var body = VBPTypeCodec.QueryBody(_nextQueryId++, sql, envs);
            var f = _mux.Call(VBPOpcodes.Query, body);

            if (f.Op == VBPOpcodes.CommandComplete)
            {
                return new VBPResult(
                    Array.Empty<string>(),
                    Array.Empty<ushort>(),
                    Array.Empty<IReadOnlyList<object?>>(),
                    "OK", 0);
            }
            if (f.Op == VBPOpcodes.DataChunk)
            {
                var dc = VBPTypeCodec.ParseDataChunk(f.Body);
                var cols = new List<string>();
                var colTypes = new List<ushort>();
                foreach (var t in dc.ColTypes)
                {
                    cols.Add(VBPTypeIds.TypeName(t));
                    colTypes.Add(t);
                }
                var rows = new List<IReadOnlyList<object?>> { dc.RowValues };
                return new VBPResult(cols, colTypes, rows, "SELECT", 0);
            }
            return new VBPResult(
                Array.Empty<string>(), Array.Empty<ushort>(),
                Array.Empty<IReadOnlyList<object?>>(),
                VBPOpcodes.OpcodeName(f.Op), 0);
        }

        public Task<long> PingAsync() => Task.Run(() => Ping());

        public long Ping()
        {
            if (_mux == null)
                throw new VBPException(VBPOpcodes.SqlStateConnectionFailure, "not connected");
            long t0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            // PING body: u64 nonce (dev server requires ≥8 bytes).
            var nonce = new byte[8];
            BinaryPrimitives.WriteInt64LittleEndian(nonce, t0);
            var pong = _mux.Call(VBPOpcodes.Ping, nonce);
            if (pong.Op != VBPOpcodes.Pong)
                throw new VBPErrorException(VBPOpcodes.SqlStateConnectionFailure,
                    "expected PONG, got " + VBPOpcodes.OpcodeName(pong.Op));
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - t0;
        }

        public Task CloseAsync() => Task.Run(() => Close());

        public void Close()
        {
            if (_mux == null) return;
            try
            {
                _mux.Call(VBPOpcodes.Close, Array.Empty<byte>(), 0, 2000);
            }
            catch { }
            _mux.Dispose();
            _mux = null;
        }

        public async ValueTask DisposeAsync()
        {
            Close();
            await Task.CompletedTask;
        }

        public void Dispose() => Close();

        public int ServerVersion => _serverVersion;
        public int ServerCaps => _serverCaps;
        public long SessionTokenLo => _sessionTokenLo;
        public long SessionTokenHi => _sessionTokenHi;

        // Internal shim: System.Text.Encoding.UTF8 (kept short to avoid namespace clutter).
        private static class Encoding_UTF8
        {
            public static byte[] GetBytes(string s) => System.Text.Encoding.UTF8.GetBytes(s);
            public static string GetString(byte[] b) => System.Text.Encoding.UTF8.GetString(b);
        }

        private static byte[] EncodeParam(object? p)
        {
            if (p == null) return VBPTypeCodec.InputEnvelopeNull(VBPTypeIds.Text);
            switch (p)
            {
                case bool b:    return VBPTypeCodec.InputEnvelope(VBPTypeIds.Bool,   VBPTypeCodec.EncodeBool(b));
                case short s:   return VBPTypeCodec.InputEnvelope(VBPTypeIds.Int2,   VBPTypeCodec.EncodeInt2(s));
                case int i:     return VBPTypeCodec.InputEnvelope(VBPTypeIds.Int4,   VBPTypeCodec.EncodeInt4(i));
                case long l:    return VBPTypeCodec.InputEnvelope(VBPTypeIds.Int8,   VBPTypeCodec.EncodeInt8(l));
                case float f:   return VBPTypeCodec.InputEnvelope(VBPTypeIds.Float4, VBPTypeCodec.EncodeFloat4(f));
                case double d:  return VBPTypeCodec.InputEnvelope(VBPTypeIds.Float8, VBPTypeCodec.EncodeFloat8(d));
                case byte[] ba: return VBPTypeCodec.InputEnvelope(VBPTypeIds.Bytea,  VBPTypeCodec.EncodeBytea(ba));
                case Guid g:    return VBPTypeCodec.InputEnvelope(VBPTypeIds.Uuid,   VBPTypeCodec.EncodeUuid(g));
                default:        return VBPTypeCodec.InputEnvelope(VBPTypeIds.Text,   VBPTypeCodec.EncodeText(p.ToString() ?? ""));
            }
        }
    }
}
