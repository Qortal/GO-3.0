import { lazy, Suspense, type CSSProperties } from 'react';

/**
 * react-loader-spinner is ~150 KB and is only ever shown behind a loading
 * flag, so it is kept out of the startup bundle and fetched on first render.
 */
const FidgetSpinner = lazy(() =>
  import('react-loader-spinner').then((m) => ({ default: m.FidgetSpinner }))
);

type LazyFidgetSpinnerProps = {
  ariaLabel?: string;
  height?: string | number;
  visible?: boolean;
  width?: string | number;
  wrapperClass?: string;
  wrapperStyle?: CSSProperties;
};

export const LazyFidgetSpinner = ({
  ariaLabel = 'loading',
  height = '80',
  visible = true,
  width = '80',
  wrapperClass = 'fidget-spinner-wrapper',
  wrapperStyle = {},
}: LazyFidgetSpinnerProps) => {
  if (!visible) return null;
  return (
    <Suspense fallback={null}>
      <FidgetSpinner
        ariaLabel={ariaLabel}
        height={height}
        visible
        width={width}
        wrapperClass={wrapperClass}
        wrapperStyle={wrapperStyle}
      />
    </Suspense>
  );
};
