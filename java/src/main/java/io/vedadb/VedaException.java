package io.vedadb;

/**
 * Exception thrown when VedaDB returns an error.
 */
public class VedaException extends Exception {
    public VedaException(String message) {
        super("VedaDB Error: " + message);
    }
}
