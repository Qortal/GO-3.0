package com.github.Qortal.qortalMobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class SectionSwipeClaimTest {

  private static final float WIDTH = 400f;
  private final List<String> events = new ArrayList<>();
  private final List<Long> probes = new ArrayList<>();
  private SectionSwipeClaim claim;

  @Before
  public void setUp() {
    claim = new SectionSwipeClaim(
      new SectionSwipeClaim.Sink() {
        @Override
        public void emit(String phase, float x, float y, long time) {
          events.add(phase + "@" + Math.round(x) + "," + Math.round(y) + "/" + time);
        }

        @Override
        public void probe(long touchId, float x, float y) {
          probes.add(touchId);
        }
      }
    );
    claim.setZone(new float[] { 0f, 100f, WIDTH, 700f });
  }

  private SectionSwipeClaim.Decision touch(int action, float x, float y, long t) {
    return claim.onTouch(action, x, y, t, 1, WIDTH);
  }

  private void downConfirmed(float x, float y, long t) {
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.DOWN, x, y, t));
    claim.confirm(probes.get(probes.size() - 1), true);
  }

  @Test
  public void claimsASidewaysSwipeOnceItIsWiderThanTall() {
    downConfirmed(200, 300, 1000);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 195, 302, 1010));
    assertEquals(SectionSwipeClaim.Decision.CLAIM, touch(SectionSwipeClaim.MOVE, 186, 304, 1020));
    assertEquals(SectionSwipeClaim.Decision.SWALLOW, touch(SectionSwipeClaim.MOVE, 150, 306, 1030));
    assertEquals(SectionSwipeClaim.Decision.SWALLOW, touch(SectionSwipeClaim.UP, 120, 306, 1040));
    assertEquals(
      List.of("start@200,300/1000", "move@186,304/1020", "move@150,306/1030", "end@120,306/1040"),
      events
    );
  }

  @Test
  public void leavesScrollingTapsAndLongPressesToTheWidget() {
    downConfirmed(200, 300, 1000);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 204, 320, 1016));
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 260, 330, 1032));
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.UP, 260, 330, 1040));

    downConfirmed(200, 300, 2000);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.UP, 200, 300, 2050));

    // Moved first, then held: a scroll, never a long press.
    downConfirmed(200, 300, 3000);
    touch(SectionSwipeClaim.MOVE, 200, 330, 3100);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 200, 331, 3450));
    assertTrue(events.isEmpty());
  }

  @Test
  public void needsThePageToSayTheZoneIsOnTop() {
    // No answer yet (or a panel over the widgets): the page keeps it.
    touch(SectionSwipeClaim.DOWN, 200, 300, 1000);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 150, 300, 1016));

    touch(SectionSwipeClaim.DOWN, 200, 300, 2000);
    claim.confirm(probes.get(probes.size() - 1), false);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 150, 300, 2016));

    // A late answer for an older touch counts for nothing.
    touch(SectionSwipeClaim.DOWN, 200, 300, 3000);
    claim.confirm(probes.get(0), true);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 150, 300, 3016));
    assertTrue(events.isEmpty());
  }

  @Test
  public void aYesThatComesAfterTheFirstMovesStillClaimsTheSwipe() {
    // The answer crosses the bridge: the swipe is sideways before it is in.
    touch(SectionSwipeClaim.DOWN, 200, 300, 1000);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 170, 301, 1008));
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 140, 302, 1016));
    claim.confirm(probes.get(probes.size() - 1), true);
    assertEquals(SectionSwipeClaim.Decision.CLAIM, touch(SectionSwipeClaim.MOVE, 110, 303, 1024));
    assertEquals(List.of("start@200,300/1000", "move@110,303/1024"), events);
  }

  @Test
  public void aNoOrNoAnswerInTimeLeavesTheSwipeToThePage() {
    touch(SectionSwipeClaim.DOWN, 200, 300, 1000);
    touch(SectionSwipeClaim.MOVE, 170, 300, 1008);
    claim.confirm(probes.get(probes.size() - 1), false);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 140, 300, 1016));

    touch(SectionSwipeClaim.DOWN, 200, 300, 2000);
    touch(SectionSwipeClaim.MOVE, 170, 300, 2008);
    // Too late: the wait is over.
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 100, 300, 2260));
    claim.confirm(probes.get(probes.size() - 1), true);
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 60, 300, 2270));
    assertTrue(events.isEmpty());
  }

  @Test
  public void aStillFingerBecomesALongPressThatGoesOnToThePage() {
    downConfirmed(200, 300, 1000);
    long id = claim.currentTouchId();
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 203, 302, 1100));
    assertTrue(claim.hold(id, 1400));
    // From here the moves are GO's (they drag the widget).
    assertEquals(SectionSwipeClaim.Decision.SWALLOW, touch(SectionSwipeClaim.MOVE, 230, 500, 1500));
    assertEquals(SectionSwipeClaim.Decision.SWALLOW, touch(SectionSwipeClaim.UP, 230, 700, 1600));
    assertEquals(List.of("hold@203,302/1400", "move@230,500/1500", "end@230,700/1600"), events);
  }

  @Test
  public void aMoveAtTheLongPressTimeTakesItEvenBeforeTheTimer() {
    downConfirmed(200, 300, 1000);
    assertEquals(SectionSwipeClaim.Decision.CLAIM, touch(SectionSwipeClaim.MOVE, 202, 301, 1405));
    assertEquals(List.of("hold@202,301/1405"), events);
  }

  @Test
  public void noLongPressAfterMovingWithoutAYesOrForAnOldTouch() {
    downConfirmed(200, 300, 1000);
    long id = claim.currentTouchId();
    touch(SectionSwipeClaim.MOVE, 200, 340, 1100); // a scroll
    assertTrue(!claim.hold(id, 1400));

    touch(SectionSwipeClaim.DOWN, 200, 300, 2000); // no answer yet
    assertTrue(!claim.hold(claim.currentTouchId(), 2400));

    downConfirmed(200, 300, 3000);
    touch(SectionSwipeClaim.UP, 200, 300, 3100);
    assertTrue(!claim.hold(id, 3400));
    assertTrue(events.isEmpty());
  }

  @Test
  public void staysOutsideTheZoneTheEdgesAndWithoutAZone() {
    touch(SectionSwipeClaim.DOWN, 200, 50, 1000);
    assertTrue(probes.isEmpty());
    touch(SectionSwipeClaim.DOWN, 10, 300, 2000);
    touch(SectionSwipeClaim.DOWN, WIDTH - 10, 300, 3000);
    assertTrue(probes.isEmpty());

    claim.setZone(null);
    touch(SectionSwipeClaim.DOWN, 200, 300, 4000);
    assertTrue(probes.isEmpty());
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.MOVE, 100, 300, 4016));
  }

  @Test
  public void aSecondFingerEndsTheSwipeAndKeepsTheRestAway() {
    downConfirmed(200, 300, 1000);
    touch(SectionSwipeClaim.MOVE, 170, 300, 1016);
    assertEquals(
      SectionSwipeClaim.Decision.SWALLOW,
      claim.onTouch(SectionSwipeClaim.POINTER_DOWN, 170, 300, 1020, 2, WIDTH)
    );
    assertEquals(
      SectionSwipeClaim.Decision.SWALLOW,
      claim.onTouch(SectionSwipeClaim.MOVE, 160, 300, 1030, 2, WIDTH)
    );
    assertEquals(SectionSwipeClaim.Decision.SWALLOW, touch(SectionSwipeClaim.UP, 160, 300, 1040));
    assertEquals("cancel@170,300/1020", events.get(events.size() - 1));
    // The next touch starts fresh.
    assertEquals(SectionSwipeClaim.Decision.PASS, touch(SectionSwipeClaim.DOWN, 200, 300, 2000));
  }

  @Test
  public void aTwoFingerStartIsNeverClaimed() {
    downConfirmed(200, 300, 1000);
    assertEquals(
      SectionSwipeClaim.Decision.PASS,
      claim.onTouch(SectionSwipeClaim.POINTER_DOWN, 200, 300, 1005, 2, WIDTH)
    );
    assertEquals(
      SectionSwipeClaim.Decision.PASS,
      claim.onTouch(SectionSwipeClaim.MOVE, 100, 300, 1016, 2, WIDTH)
    );
    assertTrue(events.isEmpty());
  }
}
