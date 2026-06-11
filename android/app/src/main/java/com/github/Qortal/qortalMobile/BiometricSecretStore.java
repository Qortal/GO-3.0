package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Android Keystore-backed wallet password (bank-style biometric gate). */
final class BiometricSecretStore {

  private static final String PREFS = "qortal_biometric_secrets";
  private static final String KEY_PREFIX = "secret_";

  private BiometricSecretStore() {}

  static String keyAlias(String address) {
    return "qortal_bio_" + address.trim().replaceAll("[^A-Za-z0-9._-]", "_");
  }

  static boolean hasSecret(Context context, String address) {
    if (address == null || address.trim().isEmpty()) {
      return false;
    }
    try {
      KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
      keyStore.load(null);
      if (!keyStore.containsAlias(keyAlias(address))) {
        return false;
      }
      return context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .contains(KEY_PREFIX + address.trim());
    } catch (Exception e) {
      return false;
    }
  }

  static void storeSecret(Context context, String address, String secret)
    throws Exception {
    deleteSecret(context, address);

    KeyGenerator keyGenerator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      "AndroidKeyStore"
    );

    KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
      keyAlias(address),
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setUserAuthenticationRequired(true);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(
        0,
        KeyProperties.AUTH_BIOMETRIC_STRONG
      );
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      builder.setUserAuthenticationValidityDurationSeconds(-1);
    }

    keyGenerator.init(builder.build());
    SecretKey secretKey = keyGenerator.generateKey();

    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, secretKey);
    byte[] iv = cipher.getIV();
    byte[] ciphertext = cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));

    JSONObject blob = new JSONObject();
    blob.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
    blob.put("data", Base64.encodeToString(ciphertext, Base64.NO_WRAP));

    context
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PREFIX + address.trim(), blob.toString())
      .apply();
  }

  static void deleteSecret(Context context, String address) {
    if (address == null || address.trim().isEmpty()) {
      return;
    }
    try {
      KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
      keyStore.load(null);
      keyStore.deleteEntry(keyAlias(address));
    } catch (Exception ignored) {
      /* ignore */
    }
    context
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_PREFIX + address.trim())
      .apply();
  }

  static final class DecryptPayload {

    final Cipher cipher;
    final byte[] ciphertext;

    DecryptPayload(Cipher cipher, byte[] ciphertext) {
      this.cipher = cipher;
      this.ciphertext = ciphertext;
    }
  }

  static DecryptPayload prepareDecrypt(Context context, String address)
    throws Exception {
    String blobString = context
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_PREFIX + address.trim(), null);
    if (blobString == null) {
      throw new IllegalStateException("No stored secret");
    }

    JSONObject blob = new JSONObject(blobString);
    byte[] iv = Base64.decode(blob.getString("iv"), Base64.NO_WRAP);
    byte[] ciphertext = Base64.decode(blob.getString("data"), Base64.NO_WRAP);

    KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
    keyStore.load(null);
    SecretKey secretKey = (SecretKey) keyStore.getKey(keyAlias(address), null);
    if (secretKey == null) {
      throw new IllegalStateException("Keystore key missing");
    }

    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    GCMParameterSpec spec = new GCMParameterSpec(128, iv);
    cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
    return new DecryptPayload(cipher, ciphertext);
  }

  static String finishDecrypt(DecryptPayload payload) throws Exception {
    byte[] plaintext = payload.cipher.doFinal(payload.ciphertext);
    return new String(plaintext, StandardCharsets.UTF_8);
  }
}
