import { useRef } from 'react';
import { ButtonBase } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import { useTranslation } from 'react-i18next';
import { DEV_ZIP_ACCEPT } from './devModeApp';
import { useDevZipOpener } from './useDevZipOpener';

/**
 * The Pinned tab's Dev Mode button: picks a Q-App .zip from the phone and
 * opens it in a tab. Styled by the caller, to match New folder.
 */
export function DevModeButton({ sx }: { sx?: SxProps<Theme> }) {
  const { t } = useTranslation(['core']);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { openZip } = useDevZipOpener();

  return (
    <>
      <ButtonBase onClick={() => inputRef.current?.click()} sx={sx}>
        <CodeRoundedIcon sx={{ fontSize: 18 }} />
        {t('core:go_dev_mode.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </ButtonBase>
      <input
        ref={inputRef}
        accept={DEV_ZIP_ACCEPT}
        data-testid="dev-mode-zip-input"
        hidden
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // The same zip can be picked again (after it changed on the phone).
          event.currentTarget.value = '';
          if (file) void openZip(file);
        }}
      />
    </>
  );
}
