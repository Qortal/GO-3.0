import { Box } from '@mui/material';

/** Small orange "DRAFT" marker shown next to a conversation that has an unsent
 * draft message. Rendered inline at the top-right of the group/user name. */
export const DraftBadge = () => (
  <Box
    component="span"
    aria-label="Draft message"
    sx={{
      color: '#f5a623',
      flexShrink: 0,
      fontSize: '10px',
      fontWeight: 700,
      letterSpacing: '0.5px',
      lineHeight: 1.3,
      textTransform: 'uppercase',
    }}
  >
    Draft
  </Box>
);
