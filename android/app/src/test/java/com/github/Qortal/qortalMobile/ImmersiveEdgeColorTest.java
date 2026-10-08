package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import org.junit.Test;

public class ImmersiveEdgeColorTest {
    private static int[] line(int background, int count) {
        int[] pixels = new int[count];
        Arrays.fill(pixels, 0xff000000 | background);
        return pixels;
    }

    @Test
    public void backgroundWinsOverIconsAndText() {
        int[] pixels = line(0x1c1e24, 540);
        // A red heart and white text on the line: smaller than the background.
        for (int i = 300; i < 360; i++) pixels[i] = 0xffe53935;
        for (int i = 40; i < 120; i += 2) pixels[i] = 0xffffffff;
        assertEquals(0x1c1e24, ImmersivePlugin.dominantColor(pixels));
    }

    @Test
    public void averagesWithinTheWinningShade() {
        int[] pixels = line(0x202020, 100);
        for (int i = 0; i < 50; i++) pixels[i] = 0xff222222;
        // Same 4-bit group, so the result sits between the two.
        assertEquals(0x212121, ImmersivePlugin.dominantColor(pixels));
    }

    @Test
    public void emptyLineReportsNothing() {
        assertEquals(-1, ImmersivePlugin.dominantColor(new int[0]));
    }

    private static int[] photo(int count, int seed) {
        // Busy picture pixels: no colour covers much of it.
        int[] pixels = new int[count];
        java.util.Random random = new java.util.Random(seed);
        for (int i = 0; i < count; i++) pixels[i] = 0xff000000 | random.nextInt(0x1000000);
        return pixels;
    }

    /** A cloudy sky: one colour give or take 16 a channel, never flat. */
    private static int[] sky(int count, int seed) {
        int[] pixels = new int[count];
        java.util.Random random = new java.util.Random(seed);
        for (int i = 0; i < count; i++) {
            int r = 0xd5 + random.nextInt(33) - 16;
            int g = 0xcb + random.nextInt(33) - 16;
            int b = 0xc9 + random.nextInt(33) - 16;
            pixels[i] = 0xff000000 | (r << 16) | (g << 8) | b;
        }
        return pixels;
    }

    private static final int ROW = 48;
    private static final int BAND = ROW * 4;

    private static ImmersivePlugin.EdgePick pick(int[] sides, int[] band, int current) {
        return ImmersivePlugin.pickEdgeColor(sides, band, current, -1);
    }

    @Test
    public void flatColourUnderTheStripWinsOverASkyAtTheSides() {
        // The Reykjavik story: a black viewer top, the photo's sky covering
        // almost half of both screen sides (loosely one colour).
        int[] sides = photo(400, 4);
        int[] clouds = sky(180, 9);
        System.arraycopy(clouds, 0, sides, 0, clouds.length);
        for (int i = 180; i < 210; i++) sides[i] = 0xff000000;
        int[] band = line(0x000000, BAND);
        assertEquals(0x000000, pick(sides, band, -1).color);
        // Opened from a feed: black on the second look, never the sky.
        ImmersivePlugin.EdgePick first = pick(sides, band, 0x0e0f14);
        assertEquals(-1, first.color);
        assertEquals(0x000000, first.pending);
        assertEquals(0x000000, ImmersivePlugin.pickEdgeColor(sides, band, 0x0e0f14, first.pending).color);
    }

    @Test
    public void headerWithTitleAndIconsIsContinued() {
        int[] band = line(0x1565c0, BAND);
        // Title letters and a menu icon on two rows, inside the edges.
        for (int i = 10; i < 22; i += 2) band[ROW + i] = 0xffffffff;
        for (int i = 12; i < 20; i += 3) band[2 * ROW + i] = 0xffffffff;
        band[2 * ROW + 44] = 0xffeeeeee;
        // A back arrow touching the first point of one row.
        band[3 * ROW] = 0xffffffff;
        int[] sides = line(0xfafafa, 400);
        assertEquals(0x1565c0, pick(sides, band, -1).color);
    }

    @Test
    public void cardWithMarginsIsNotTakenForTheTop() {
        // A post card under the strip; the page shows at both edges.
        int[] band = line(0x1c1e24, BAND);
        for (int row = 0; row < 4; row++) {
            band[row * ROW] = 0xff121318;
            band[row * ROW + ROW - 1] = 0xff121318;
        }
        assertEquals(-1, ImmersivePlugin.flatBandColor(band));
        assertEquals(0x121318, pick(line(0x121318, 400), band, -1).color);
    }

    @Test
    public void newColourUnderTheStripIsTakenOnASecondLook() {
        int[] sides = line(0x121318, 400);
        int[] band = line(0x2a2d36, BAND);
        ImmersivePlugin.EdgePick first = ImmersivePlugin.pickEdgeColor(sides, band, 0x121318, -1);
        assertEquals(-1, first.color);
        assertEquals(0x2a2d36, first.pending);
        ImmersivePlugin.EdgePick second =
            ImmersivePlugin.pickEdgeColor(sides, band, 0x121318, first.pending);
        assertEquals(0x2a2d36, second.color);
        assertEquals(-1, second.pending);
        // Scrolled on: something else there now, so it is only noted again.
        ImmersivePlugin.EdgePick moved =
            ImmersivePlugin.pickEdgeColor(sides, line(0x3c4050, BAND), 0x121318, first.pending);
        assertEquals(-1, moved.color);
        assertEquals(0x3c4050, moved.pending);
    }

    @Test
    public void pageColourUnderTheStripIsTakenAtOnce() {
        int[] band = line(0x121318, BAND);
        // Light dithering of a painted colour still counts as flat.
        for (int i = 0; i < BAND; i += 3) band[i] = 0xff131418;
        ImmersivePlugin.EdgePick pick = pick(photo(400, 6), band, 0x121318);
        assertEquals(0x121318, pick.color);
        assertEquals(-1, pick.pending);
    }

    @Test
    public void pictureUnderTheStripKeepsThePageBackground() {
        // 35% background at the sides: kept while a photo passes under.
        int[] sides = photo(400, 3);
        for (int i = 0; i < 140; i++) sides[i] = 0xff121318;
        ImmersivePlugin.EdgePick pick = pick(sides, photo(BAND, 8), 0x121318);
        assertEquals(-1, pick.color);
        assertEquals(-1, pick.pending);
    }

    @Test
    public void pictureUnderTheStripOnAFeedTakesThePageBackground() {
        int[] sides = line(0x0e0f14, 400);
        for (int i = 0; i < 120; i++) sides[i] = 0xff000000 | (i * 0x020301);
        assertEquals(0x0e0f14, pick(sides, photo(BAND, 2), -1).color);
        // After a black viewer on a light page, the page comes back.
        assertEquals(0xffffff, pick(line(0xffffff, 400), photo(BAND, 2), 0x000000).color);
    }

    @Test
    public void photoEverywhereIsFramedInBlack() {
        assertEquals(ImmersivePlugin.MEDIA_BACKGROUND, pick(photo(400, 1), photo(BAND, 2), -1).color);
        // A sky out to both sides is not a page background either.
        int[] sides = sky(400, 11);
        assertEquals(ImmersivePlugin.MEDIA_BACKGROUND, pick(sides, sky(BAND, 12), 0x121318).color);
    }

    @Test
    public void withoutTheBandTheSidesStillDecide() {
        assertEquals(0x0e0f14, pick(line(0x0e0f14, 400), new int[0], -1).color);
        int[] sides = photo(400, 5);
        // Nothing says it is a picture: keep what is on show.
        assertEquals(-1, pick(sides, new int[0], 0x0e0f14).color);
        assertEquals(ImmersivePlugin.dominantColor(sides), pick(sides, new int[0], -1).color);
    }
}
