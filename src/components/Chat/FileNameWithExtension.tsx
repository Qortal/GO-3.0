import { Box, type SxProps, type Theme } from '@mui/material';
import { splitFileNameForDisplay } from '../../utils/receivedFileName';

type Props = {
  /** The name as the sender gave it; cleaned here. */
  name: unknown;
  /** Shown when nothing is left of the name. */
  fallback: string;
  sx?: SxProps<Theme>;
};

/**
 * A file name someone else chose, shown so its real type is always visible:
 * invisible and bidi characters removed, the stem cut short with an ellipsis
 * when it does not fit, and the extension always shown whole after it, in
 * its own left-to-right run (N-27).
 */
export const FileNameWithExtension = ({ name, fallback, sx }: Props) => {
  const { stem, extension } = splitFileNameForDisplay(name);
  const shownStem = stem || (extension ? '' : fallback);
  return (
    <Box
      component="span"
      title={`${shownStem}${extension}`}
      sx={[
        {
          display: 'flex',
          minWidth: 0,
          maxWidth: '100%',
          whiteSpace: 'nowrap',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          unicodeBidi: 'isolate',
        }}
      >
        {shownStem}
      </Box>
      {extension && (
        <Box
          component="span"
          dir="ltr"
          sx={{ flexShrink: 0, unicodeBidi: 'isolate' }}
        >
          {extension}
        </Box>
      )}
    </Box>
  );
};
