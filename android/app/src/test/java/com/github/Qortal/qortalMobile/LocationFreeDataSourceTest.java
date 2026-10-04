package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.media.MediaFormat;

import com.otaliastudios.transcoder.common.TrackType;
import com.otaliastudios.transcoder.source.DataSource;

import org.junit.Test;

public class LocationFreeDataSourceTest {

    /** A source that recorded GPS, like a geotagged phone video. */
    private static final class GeotaggedSource implements DataSource {
        boolean initialized;
        long seekedTo = -1;

        @Override public void initialize() { initialized = true; }
        @Override public void deinitialize() { initialized = false; }
        @Override public boolean isInitialized() { return initialized; }
        @Override public int getOrientation() { return 90; }
        @Override public double[] getLocation() { return new double[] {51.5021, -0.1263}; }
        @Override public long getDurationUs() { return 4_000_000L; }
        @Override public MediaFormat getTrackFormat(TrackType type) { return null; }
        @Override public void selectTrack(TrackType type) { }
        @Override public long seekTo(long desiredPositionUs) { seekedTo = desiredPositionUs; return desiredPositionUs; }
        @Override public boolean canReadTrack(TrackType type) { return true; }
        @Override public void readTrack(Chunk chunk) { }
        @Override public long getPositionUs() { return 1234L; }
        @Override public boolean isDrained() { return false; }
        @Override public void releaseTrack(TrackType type) { }
    }

    @Test
    public void hidesTheRecordingLocation() {
        GeotaggedSource source = new GeotaggedSource();
        assertNotNull(source.getLocation());
        assertNull(new LocationFreeDataSource(source).getLocation());
    }

    @Test
    public void keepsEverythingElse() {
        GeotaggedSource source = new GeotaggedSource();
        LocationFreeDataSource wrapped = new LocationFreeDataSource(source);
        wrapped.initialize();
        assertTrue(source.isInitialized());
        assertEquals(90, wrapped.getOrientation());
        assertEquals(4_000_000L, wrapped.getDurationUs());
        assertEquals(500L, wrapped.seekTo(500L));
        assertEquals(500L, source.seekedTo);
        assertEquals(1234L, wrapped.getPositionUs());
    }
}
