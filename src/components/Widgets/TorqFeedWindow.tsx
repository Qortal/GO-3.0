import { useCallback, useState, type ComponentProps } from 'react';
import { DashboardWidgetFrame } from './DashboardWidgetFrame';
import { QuitterFeedWidget } from './QuitterFeedWidget';
import {
  HomeQuitterComposer,
  type HomeComposerPublished,
} from './quitter/HomeQuitterComposer';
import { feedItemFromPublishedPost } from './quitter/quitterFeedApi';
import type { QuitterFeedItem } from './quitter/quitterFeedTypes';

type FrameProps = Omit<
  ComponentProps<typeof DashboardWidgetFrame>,
  'children' | 'top'
>;
type FeedProps = Omit<ComponentProps<typeof QuitterFeedWidget>, 'ownPost'>;

type TorqFeedWindowProps = FrameProps & {
  /** The feed's settings; null while the feed is turned off on Home. */
  feed: FeedProps | null;
};

/**
 * Home's Torq window: posting on top (a "Post to Torq" entry that opens the
 * whole composer in place) and Torq's feed under it. A post published here
 * goes to the top of the feed at once. With the feed turned off, Home shows
 * the window only while the composer is open (a share from another app),
 * and then with the composer alone.
 */
export const TorqFeedWindow = ({
  feed,
  onRefresh,
  ...frame
}: TorqFeedWindowProps) => {
  const [ownPost, setOwnPost] = useState<QuitterFeedItem | null>(null);

  const handlePublished = useCallback(
    ({ author, postIdentifier, post }: HomeComposerPublished) => {
      setOwnPost(feedItemFromPublishedPost(author, postIdentifier, post));
      // Others' new posts too, as after a tap on refresh.
      onRefresh?.();
    },
    [onRefresh]
  );

  return (
    <DashboardWidgetFrame
      {...frame}
      onRefresh={feed ? onRefresh : undefined}
      top={<HomeQuitterComposer onPublished={handlePublished} />}
    >
      {feed ? <QuitterFeedWidget {...feed} ownPost={ownPost} /> : null}
    </DashboardWidgetFrame>
  );
};
