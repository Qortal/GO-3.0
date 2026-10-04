package com.github.Qortal.qortalMobile;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.otaliastudios.transcoder.source.DataSource;
import com.otaliastudios.transcoder.source.DataSourceWrapper;

/**
 * Transcoder input that hides the source video's recording location.
 *
 * DeepMedia's engine copies the first non-null {@link DataSource#getLocation()}
 * into {@code DataSink.setLocation}, which makes MediaMuxer write the GPS
 * position into the output's {@code moov/udta/©xyz} box. Quitter videos are
 * published to public, permanent QDN, so the compressed copy must never carry
 * it. Everything else (tracks, orientation, duration, seeking) is delegated
 * unchanged.
 */
final class LocationFreeDataSource extends DataSourceWrapper {

    LocationFreeDataSource(@NonNull DataSource source) {
        super(source);
    }

    @Nullable
    @Override
    public double[] getLocation() {
        return null;
    }
}
