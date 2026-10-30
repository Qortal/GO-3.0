package com.github.Qortal.qortalMobile;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public abstract class Crypto {

    /**
     * Returns 32-byte SHA-256 digest of message passed in input.
     * 
     * @param input
     *            variable-length byte[] message
     * @return byte[32] digest, or null if SHA-256 algorithm can't be accessed
     */
    public static byte[] digest(byte[] input) {
        if (input == null)
            return null;

        try {
            // SHA2-256
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            return sha256.digest(input);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 message digest not available");
        }
    }
}
