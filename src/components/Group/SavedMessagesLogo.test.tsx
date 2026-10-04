import { render } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { SavedMessagesLogo } from './SavedMessagesLogo';

const renderLogo = (mode: 'light' | 'dark') => {
  render(
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <SavedMessagesLogo size={20} />
    </ThemeProvider>
  );
  const logo = document.querySelector(
    '[data-saved-messages-logo]'
  ) as HTMLImageElement;
  return { logo, style: getComputedStyle(logo) };
};

describe('SavedMessagesLogo', () => {
  it('is decorative and takes the given size', () => {
    const { logo, style } = renderLogo('dark');
    expect(logo.getAttribute('alt')).toBe('');
    expect(logo.getAttribute('aria-hidden')).toBe('true');
    expect(style.width).toBe('20px');
    expect(style.height).toBe('20px');
  });

  it('keeps the white logo in the dark theme', () => {
    const { style } = renderLogo('dark');
    expect(style.filter).toBe('none');
  });

  it('turns the white logo dark in the light theme, so it shows', () => {
    const { style } = renderLogo('light');
    expect(style.filter).toBe('invert(1)');
  });
});
