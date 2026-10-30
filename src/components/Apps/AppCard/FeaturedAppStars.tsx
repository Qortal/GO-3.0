import { Box, Rating, Typography, alpha, useTheme } from '@mui/material';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import { useTranslation } from 'react-i18next';
import { useAppRating } from '../../../hooks/useAppRatings';

// One score format per language, not one per render of every banner.
const scoreFormats = new Map<string, Intl.NumberFormat>();
const scoreFormat = (language: string): Intl.NumberFormat => {
  let format = scoreFormats.get(language);
  if (!format) {
    format = new Intl.NumberFormat(language, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
    scoreFormats.set(language, format);
  }
  return format;
};

/** Read-only gold stars with the average and the number of votes. */
export const FeaturedAppStars = ({ app }: { app: any }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const { rating, containerRef } = useAppRating(app?.name, app?.service);
  const gold = theme.palette.other?.rating ?? theme.palette.warning.light;

  const votes = rating?.totalVotes ?? 0;
  const average = votes > 0 ? (rating?.averageRating ?? 0) : 0;
  const score = scoreFormat(i18n.language).format(average);

  return (
    <Box
      ref={containerRef}
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: '4px',
        justifyContent: 'center',
        minHeight: '18px',
      }}
    >
      <Rating
        emptyIcon={<StarRoundedIcon fontSize="inherit" />}
        getLabelText={() =>
          t('core:app_detail.rating_stars_label', {
            postProcess: 'capitalizeFirstChar',
            score,
          })
        }
        icon={<StarRoundedIcon fontSize="inherit" />}
        precision={0.1}
        readOnly
        sx={{
          color: gold,
          fontSize: '17px',
          '& .MuiRating-iconEmpty': { color: alpha(gold, 0.3) },
        }}
        value={average}
      />
      {votes > 0 ? (
        <Typography
          component="span"
          sx={{ color: gold, fontSize: '12px', fontWeight: 700 }}
        >
          {score}
        </Typography>
      ) : null}
      <Typography
        aria-label={t('core:app_detail.ratings_count', { count: votes })}
        component="span"
        sx={{ color: theme.palette.text.secondary, fontSize: '11px' }}
      >
        ({votes})
      </Typography>
    </Box>
  );
};
