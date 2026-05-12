package io.vedadb;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Audit #23 closure for the Java driver: formatValue() escapes
 * single quotes (SQL-standard doubling) and type-distinguishes
 * numeric/boolean/null. The new executePreparedTyped surface
 * additionally rejects NUL bytes in String args.
 *
 * Pure-unit tests — no network needed. Live integration lives in
 * VedaClientTest.
 */
class VedaClientFormatTest {

    private final VedaClient client = newOfflineClient();

    private static VedaClient newOfflineClient() {
        // We never call connect() — formatValue is a pure function
        // and doesn't touch the socket.
        try {
            return VedaClient.class
                    .getDeclaredConstructor(String.class, int.class)
                    .newInstance("localhost", 6380);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void nullBecomesNULL() {
        assertEquals("NULL", client.formatValue(null));
    }

    @Test
    void booleanUppercase() {
        assertEquals("TRUE", client.formatValue(Boolean.TRUE));
        assertEquals("FALSE", client.formatValue(Boolean.FALSE));
    }

    @Test
    void integerNoQuotes() {
        assertEquals("42", client.formatValue(42));
        assertEquals("-7", client.formatValue(-7));
    }

    @Test
    void floatNoQuotes() {
        assertTrue(client.formatValue(3.14).contains("3.14"));
    }

    @Test
    void stringQuoted() {
        assertEquals("'alice'", client.formatValue("alice"));
    }

    @Test
    void singleQuoteDoubled() {
        assertEquals("'O''Brien'", client.formatValue("O'Brien"));
        assertEquals(
                "'''; DROP TABLE users; --'",
                client.formatValue("'; DROP TABLE users; --"));
    }

    @Test
    void executePreparedTypedRejectsNUL() {
        String nulArg = "a" + (char) 0 + "b";
        VedaException ex = assertThrows(VedaException.class,
                () -> client.executePreparedTyped("p", nulArg));
        assertTrue(ex.getMessage().contains("NUL"),
                "expected NUL in message, got: " + ex.getMessage());
    }
}
