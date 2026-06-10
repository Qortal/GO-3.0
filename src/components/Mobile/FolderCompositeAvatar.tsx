import { Box } from '@mui/material';
import type { OpenTab } from './useOpenTabs';
import { TabAvatar } from './MobileTabsOverlay.shared';

type FolderCompositeAvatarProps = {
  tabs: OpenTab[];
  getTitle: (tab: OpenTab) => string;
  size?: number;
};

const MiniAvatar = ({
  tab,
  title,
  size,
}: {
  tab: OpenTab;
  title: string;
  size: number;
}) => (
  <Box
    sx={{
      width: size,
      height: size,
      borderRadius: 1,
      overflow: 'hidden',
      flexShrink: 0,
    }}
  >
    <TabAvatar tab={tab} title={title} color="#5b8def" size={size} />
  </Box>
);

export function FolderCompositeAvatar({
  tabs,
  getTitle,
  size = 44,
}: FolderCompositeAvatarProps) {
  const items = tabs.slice(0, 4);

  if (items.length === 0) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: 1.5,
          bgcolor: 'action.hover',
        }}
      />
    );
  }

  if (items.length === 1) {
    return (
      <MiniAvatar tab={items[0]} title={getTitle(items[0])} size={size} />
    );
  }

  if (items.length === 2) {
    const half = Math.floor(size / 2) - 1;
    return (
      <Box
        sx={{
          width: size,
          height: size,
          display: 'flex',
          gap: '2px',
          alignItems: 'center',
        }}
      >
        {items.map((tab) => (
          <MiniAvatar
            key={getTitle(tab)}
            tab={tab}
            title={getTitle(tab)}
            size={half}
          />
        ))}
      </Box>
    );
  }

  const cell = Math.floor(size / 2) - 1;

  if (items.length === 3) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          alignItems: 'center',
        }}
      >
        <MiniAvatar tab={items[0]} title={getTitle(items[0])} size={cell} />
        <Box sx={{ display: 'flex', gap: '2px' }}>
          {items.slice(1).map((tab) => (
            <MiniAvatar
              key={getTitle(tab)}
              tab={tab}
              title={getTitle(tab)}
              size={cell}
            />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2px',
      }}
    >
      {items.map((tab) => (
        <MiniAvatar
          key={getTitle(tab)}
          tab={tab}
          title={getTitle(tab)}
          size={cell}
        />
      ))}
    </Box>
  );
}
