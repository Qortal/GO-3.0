import { useMemo, useState } from 'react';
import {
  Box,
  LinearProgress,
  Rating,
  alpha,
  styled,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { StarFilledIcon } from '../../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../../assets/Icons/StarEmpty';
import { useAppRating } from '../../../hooks/useAppRatings';

interface RatingDistribution {
  rating: number;
  count: number;
  percentage: number;
}

interface AppRatingBreakdownProps {
  app: any;
  myName: string;
  // Returns a success flag so we can roll back the optimistic highlight.
  onRate?: (rating: number) => void | Promise<boolean | void>;
}

const BreakdownContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
});

const SummaryRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  marginBottom: '16px',
});

const AverageContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: '80px',
});

const AverageValue = styled(Typography)(({ theme }) => ({
  fontSize: '48px',
  fontWeight: 700,
  color: theme.palette.text.primary,
  lineHeight: 1,
}));

const TotalRatings = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
  marginTop: '4px',
}));

const DistributionContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flex: 1,
});

const RatingRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const RatingLabel = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
  width: '20px',
  textAlign: 'right',
}));

const ProgressBar = styled(LinearProgress)(({ theme }) => ({
  flex: 1,
  height: '8px',
  borderRadius: '4px',
  backgroundColor: theme.palette.action.hover,
  '& .MuiLinearProgress-bar': {
    backgroundColor: theme.palette.warning.main,
    borderRadius: '4px',
  },
}));

const CountLabel = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
  width: '40px',
  textAlign: 'right',
}));

const RateSection = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: alpha(theme.palette.warning.main, 0.08),
  border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
  borderRadius: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  marginTop: '12px',
  padding: '20px 16px 24px',
  width: '100%',
}));

const RateTitle = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontSize: '17px',
  fontWeight: 600,
  textAlign: 'center',
}));

const RateHint = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '13px',
  fontWeight: 500,
  minHeight: '20px',
  textAlign: 'center',
  transition: 'color 0.15s ease',
}));

const RATE_HINT_KEYS: Record<number, string> = {
  1: 'core:app_detail.rate_hint_1',
  2: 'core:app_detail.rate_hint_2',
  3: 'core:app_detail.rate_hint_3',
  4: 'core:app_detail.rate_hint_4',
  5: 'core:app_detail.rate_hint_5',
};

const RATE_HINT_DEFAULTS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Great',
  5: 'Excellent',
};

export const AppRatingBreakdown = ({
  app,
  myName,
  onRate,
}: AppRatingBreakdownProps) => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  // Optimistic selection so the chosen stars stay lit immediately on tap.
  const [selectedValue, setSelectedValue] = useState(0);

  const { rating, isLoading } = useAppRating(app?.name, app?.service);

  const { averageRating, totalVotes, distribution } = useMemo(() => {
    if (!rating) {
      return { averageRating: 0, totalVotes: 0, distribution: [] };
    }

    const voteCounts = rating.voteCounts || [];
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    voteCounts.forEach((vote) => {
      if (!vote.optionName.startsWith('initialValue-')) {
        const ratingValue = parseInt(vote.optionName, 10);
        if (ratingValue >= 1 && ratingValue <= 5) {
          counts[ratingValue] = vote.voteCount;
        }
      }
    });
    voteCounts.forEach((vote) => {
      if (vote.optionName.startsWith('initialValue-')) {
        const initialRating = parseInt(vote.optionName.split('-')[1], 10);
        if (initialRating >= 1 && initialRating <= 5) {
          counts[initialRating] += 1;
        }
      }
    });

    let total = 0;
    Object.values(counts).forEach((count) => {
      total += count;
    });

    const dist: RatingDistribution[] = [5, 4, 3, 2, 1].map((r) => ({
      rating: r,
      count: counts[r],
      percentage: total > 0 ? (counts[r] / total) * 100 : 0,
    }));

    return {
      averageRating: rating.averageRating,
      totalVotes: total,
      distribution: dist,
    };
  }, [rating]);

  const starSize = isMobile ? '3.25rem' : '2.75rem';

  const hintText = hoverValue
    ? t(RATE_HINT_KEYS[hoverValue], {
        postProcess: 'capitalizeFirstChar',
        defaultValue: RATE_HINT_DEFAULTS[hoverValue],
      })
    : t('core:app_detail.rate_tap_hint', {
        postProcess: 'capitalizeFirstChar',
        defaultValue: 'Tap a star to rate this app',
      });

  if (isLoading) {
    return (
      <BreakdownContainer>
        <Typography color="text.secondary">
          {t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </BreakdownContainer>
    );
  }

  return (
    <BreakdownContainer>
      <SummaryRow>
        <AverageContainer>
          <AverageValue>{averageRating.toFixed(1)}</AverageValue>
          <Rating
            value={averageRating}
            precision={0.1}
            readOnly
            size="small"
            icon={<StarFilledIcon />}
            emptyIcon={<StarEmptyIcon />}
            sx={{ mt: 1 }}
          />
          <TotalRatings>
            {totalVotes}{' '}
            {t('core:app_detail.ratings', {
              postProcess: 'capitalizeFirstChar',
            })}
          </TotalRatings>
        </AverageContainer>

        <DistributionContainer>
          {distribution.map((item) => (
            <RatingRow key={item.rating}>
              <RatingLabel>{item.rating}</RatingLabel>
              <ProgressBar variant="determinate" value={item.percentage} />
              <CountLabel>({item.count})</CountLabel>
            </RatingRow>
          ))}
        </DistributionContainer>
      </SummaryRow>

      {onRate && (
        <RateSection>
          <RateTitle>
            {t('core:app_detail.rate_this_app', {
              postProcess: 'capitalizeFirstChar',
            })}
          </RateTitle>

          <Rating
            value={selectedValue}
            onChange={(_, value) => {
              if (value != null) {
                // Highlight immediately, then roll back if the vote fails.
                setSelectedValue(value);
                Promise.resolve(onRate(value))
                  .then((ok) => {
                    if (ok === false) setSelectedValue(0);
                  })
                  .catch(() => setSelectedValue(0));
              }
            }}
            onChangeActive={(_, value) => setHoverValue(value)}
            precision={1}
            size="large"
            icon={<StarFilledIcon />}
            emptyIcon={<StarEmptyIcon />}
            sx={{
              '& .MuiRating-icon': {
                margin: isMobile ? '0 6px' : '0 4px',
                padding: '6px',
                transition:
                  'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.15s ease',
              },
              '& .MuiRating-iconActive': {
                filter: 'drop-shadow(0 2px 8px rgba(255, 180, 0, 0.45))',
                transform: 'scale(1.08)',
              },
              '& .MuiRating-iconEmpty svg path': {
                fill: `${alpha(theme.palette.text.secondary, 0.35)} !important`,
              },
              '& .MuiRating-iconFilled svg path': {
                fill: '#FFB400 !important',
              },
              '& .MuiRating-iconHover': {
                filter: 'drop-shadow(0 4px 10px rgba(255, 215, 0, 0.55))',
                transform: 'scale(1.18)',
              },
              '& .MuiRating-iconHover svg path': {
                fill: '#FFD700 !important',
              },
              fontSize: starSize,
            }}
          />

          <RateHint
            sx={{
              color: hoverValue
                ? theme.palette.warning.dark
                : theme.palette.text.secondary,
            }}
          >
            {hintText}
          </RateHint>
        </RateSection>
      )}
    </BreakdownContainer>
  );
};
