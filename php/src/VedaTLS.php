<?php

declare(strict_types=1);

namespace VedaDB;

/**
 * TLS/SSL context builder for VedaDB connections.
 */
class VedaTLS
{
    private bool $verifyPeer;
    private bool $verifyPeerName;
    private bool $allowSelfSigned;
    private ?string $caFile;
    private ?string $certFile;
    private ?string $keyFile;
    private ?string $peerName;
    private string $minVersion;

    public function __construct(
        bool $verifyPeer = true,
        bool $verifyPeerName = true,
        bool $allowSelfSigned = false,
        ?string $caFile = null,
        ?string $certFile = null,
        ?string $keyFile = null,
        ?string $peerName = null,
        string $minVersion = '1.2',
    ) {
        $this->verifyPeer       = $verifyPeer;
        $this->verifyPeerName   = $verifyPeerName;
        $this->allowSelfSigned  = $allowSelfSigned;
        $this->caFile           = $caFile;
        $this->certFile         = $certFile;
        $this->keyFile          = $keyFile;
        $this->peerName         = $peerName;
        $this->minVersion       = $minVersion;
    }

    /**
     * Build an SSL context array for stream_context_create().
     *
     * @return array<string, mixed>
     */
    public function buildContext(): array
    {
        $ssl = [
            'verify_peer'       => $this->verifyPeer,
            'verify_peer_name'  => $this->verifyPeerName,
            'allow_self_signed' => $this->allowSelfSigned,
            'SNI_enabled'       => true,
            'disable_compression' => true,
        ];

        if ($this->caFile !== null) {
            $ssl['cafile'] = $this->caFile;
        }

        if ($this->certFile !== null) {
            $ssl['local_cert'] = $this->certFile;
        }

        if ($this->keyFile !== null) {
            $ssl['local_pk'] = $this->keyFile;
        }

        if ($this->peerName !== null) {
            $ssl['peer_name'] = $this->peerName;
        }

        $ssl['crypto_method'] = match ($this->minVersion) {
            '1.3' => STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT,
            '1.2' => STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT,
            '1.1' => STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT,
            '1.0' => STREAM_CRYPTO_METHOD_TLSv1_0_CLIENT,
            default => STREAM_CRYPTO_METHOD_TLS_CLIENT,
        };

        return ['ssl' => $ssl];
    }

    /**
     * Create a stream context.
     *
     * @return resource
     */
    public function createContext()
    {
        $ctx = stream_context_create($this->buildContext());
        if ($ctx === false) {
            throw new TLSSException('Failed to create TLS stream context');
        }
        return $ctx;
    }

    /**
     * Upgrade an existing stream to TLS.
     *
     * @param resource $stream
     */
    public function upgrade($stream): void
    {
        $options = $this->buildContext();
        foreach ($options['ssl'] as $key => $value) {
            stream_context_set_option($stream, 'ssl', $key, $value);
        }

        $method = match ($this->minVersion) {
            '1.3' => STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT,
            '1.2' => STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT,
            '1.1' => STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT,
            default => STREAM_CRYPTO_METHOD_TLS_CLIENT,
        };

        $result = @stream_socket_enable_crypto($stream, true, $method);
        if ($result !== true) {
            throw new TLSSException('TLS handshake failed');
        }
    }

    /**
     * Parse TLS options from a configuration array.
     *
     * @param array<string, mixed> $config
     */
    public static function fromConfig(array $config): self
    {
        return new self(
            verifyPeer:      $config['tls_verify'] ?? true,
            verifyPeerName:  $config['tls_verify_name'] ?? true,
            allowSelfSigned: $config['tls_allow_self_signed'] ?? false,
            caFile:          $config['tls_ca'] ?? null,
            certFile:        $config['tls_cert'] ?? null,
            keyFile:         $config['tls_key'] ?? null,
            peerName:        $config['tls_peer_name'] ?? null,
            minVersion:      $config['tls_version'] ?? '1.2',
        );
    }

    /**
     * Create development mode TLS (no verification).
     */
    public static function development(): self
    {
        return new self(
            verifyPeer:      false,
            verifyPeerName:  false,
            allowSelfSigned: true,
        );
    }

    /**
     * Create production TLS (full verification).
     */
    public static function production(?string $caFile = null): self
    {
        return new self(
            verifyPeer:     true,
            verifyPeerName: true,
            caFile:         $caFile,
        );
    }
}
