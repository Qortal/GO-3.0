package com.github.Qortal.qortalMobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.Base64;
import android.util.Log;

/**
 * Covers for the background player: decodes the picture a frame sent
 * (a small JPEG data: URL, see go_media_watch.js), puts the small Qortal
 * logo in its bottom-right corner, and draws GO's own cover when the media
 * has none.
 */
final class MediaArtwork {
    private static final String TAG = "QortalMedia";
    /** Longest side of a cover handed to Android (the system scales it down anyway). */
    static final int COVER_MAX_PX = 512;
    /** Sources bigger than this are refused before decoding. */
    private static final int MAX_SOURCE_PX = 4096;

    private static Bitmap logo;

    private MediaArtwork() {}

    /** A frame's data: URL as a bitmap no bigger than {@link #COVER_MAX_PX}, or null. */
    static Bitmap decodeDataUrl(String dataUrl) {
        if (dataUrl == null) return null;
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:image/") || comma < 0 || comma > 64) return null;
        if (!dataUrl.substring(0, comma).endsWith(";base64")) return null;
        byte[] bytes;
        try {
            bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int w = bounds.outWidth;
            int h = bounds.outHeight;
            if (w <= 0 || h <= 0 || w > MAX_SOURCE_PX || h > MAX_SOURCE_PX) return null;
            int sample = 1;
            while (Math.max(w, h) / (sample * 2) >= COVER_MAX_PX) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (decoded == null) return null;
            return fit(decoded);
        } catch (RuntimeException | OutOfMemoryError e) {
            Log.w(TAG, "Cover could not be decoded", e);
            return null;
        }
    }

    private static Bitmap fit(Bitmap source) {
        int w = source.getWidth();
        int h = source.getHeight();
        float scale = Math.min(1f, COVER_MAX_PX / (float) Math.max(w, h));
        if (scale >= 1f) return source;
        Bitmap scaled = Bitmap.createScaledBitmap(
            source, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
        if (scaled != source) source.recycle();
        return scaled;
    }

    /**
     * The cover the notification shows: the media's own picture with the
     * Qortal logo bottom right ({@code withLogo}), or GO's cover (the logo
     * on a dark blue gradient) when there is no picture.
     */
    static Bitmap compose(Context context, Bitmap cover, boolean withLogo) {
        try {
            if (cover == null) return defaultCover(context);
            int w = cover.getWidth();
            int h = cover.getHeight();
            Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            canvas.drawBitmap(cover, 0, 0, new Paint(Paint.FILTER_BITMAP_FLAG));
            if (withLogo) drawBadge(context, canvas, w, h);
            return out;
        } catch (RuntimeException | OutOfMemoryError e) {
            Log.w(TAG, "Cover could not be drawn", e);
            return cover;
        }
    }

    private static void drawBadge(Context context, Canvas canvas, int w, int h) {
        Bitmap mark = logo(context);
        if (mark == null) return;
        int[] r = MediaPlayerPolicy.logoBadgeRect(w, h);
        int left = r[0];
        int top = r[1];
        int size = r[2];
        // A soft dark halo keeps the blue logo readable on any picture.
        float cx = left + size / 2f;
        float cy = top + size / 2f;
        float halo = size * 0.78f;
        Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
        shade.setShader(new RadialGradient(
            cx, cy, halo,
            new int[] {Color.argb(150, 0, 0, 0), Color.argb(70, 0, 0, 0), Color.argb(0, 0, 0, 0)},
            new float[] {0f, 0.6f, 1f},
            Shader.TileMode.CLAMP));
        canvas.drawCircle(cx, cy, halo, shade);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(mark, null, new Rect(left, top, left + size, top + size), paint);
    }

    /** GO's cover: the Qortal logo on a dark blue gradient, with a soft glow. */
    static Bitmap defaultCover(Context context) {
        int size = COVER_MAX_PX;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint bg = new Paint();
        bg.setShader(new LinearGradient(
            0, 0, size, size,
            new int[] {Color.rgb(0x1d, 0x3a, 0x6b), Color.rgb(0x10, 0x1a, 0x33), Color.rgb(0x0a, 0x0d, 0x16)},
            new float[] {0f, 0.55f, 1f},
            Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, size, size, bg);
        Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        glow.setShader(new RadialGradient(
            size / 2f, size / 2f, size * 0.42f,
            new int[] {Color.argb(110, 0x2f, 0x9b, 0xff), Color.argb(0, 0x2f, 0x9b, 0xff)},
            null,
            Shader.TileMode.CLAMP));
        canvas.drawCircle(size / 2f, size / 2f, size * 0.42f, glow);
        Bitmap mark = logo(context);
        if (mark != null) {
            float logoSize = size * 0.46f;
            float left = (size - logoSize) / 2f;
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
            canvas.drawBitmap(mark, null, new RectF(left, left, left + logoSize, left + logoSize), paint);
        }
        return out;
    }

    private static synchronized Bitmap logo(Context context) {
        if (logo != null) return logo;
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inScaled = false;
            logo = BitmapFactory.decodeResource(context.getResources(), R.drawable.ic_qortal_logo, opts);
        } catch (RuntimeException e) {
            logo = null;
        }
        return logo;
    }
}
