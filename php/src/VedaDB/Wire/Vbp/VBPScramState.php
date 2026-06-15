<?php
declare(strict_types=1);

namespace VedaDB\Wire\Vbp;

/**
 * Mutable SCRAM handshake state, carried between the 4 messages.
 *
 *   client-first → server-first → client-final → server-final
 *
 * After client_first, the client fills in clientNonce.
 * After server_first + client_final, the client fills in combinedNonce,
 * saltedPassword, storedKey, serverKey, authMessage, clientProof.
 * After server_final, the client verifies the server signature.
 */
final class VBPScramState
{
    public function __construct(
        public string $clientNonce,
        public ?string $combinedNonce = null,
        public ?string $authMessage = null,
        public ?string $saltedPassword = null,
        public ?string $storedKey = null,
        public ?string $serverKey = null,
        public ?string $clientProof = null,
    ) {
    }
}
