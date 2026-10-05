import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { Provider, createStore } from 'jotai';
import { beforeEach, describe, expect, it } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { reticulumChatTextScaleAtom } from '../../atoms/global';
import { ReticulumTextSizeSettings } from './ReticulumTextSizeSettings';

const STORAGE_KEY = 'qortal_reticulum_chat_text_scale';

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      reticulum: {
        settings: {
          text_size: {
            default: { detail: 'The usual size', label: 'Default' },
            description: 'Sets how big text is.',
            large: { detail: 'Easier to read', label: 'Large' },
            preview: {
              incoming: 'Is this text easy to read?',
              label: 'Preview',
              outgoing: 'Yes, this size suits me.',
              sender: 'Alice',
            },
            sample: 'Aa',
            small: { detail: 'Fits more', label: 'Small' },
            title: 'Text size',
          },
        },
      },
    },
  },
});

const renderSettings = () => {
  const store = createStore();
  render(
    <I18nextProvider i18n={i18n}>
      <Provider store={store}>
        <ThemeProvider theme={darkTheme}>
          <ReticulumTextSizeSettings />
        </ThemeProvider>
      </Provider>
    </I18nextProvider>
  );
  return store;
};

const radios = () =>
  within(screen.getByRole('radiogroup', { name: 'Text size' })).getAllByRole(
    'radio'
  );

describe('ReticulumTextSizeSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers Small, Default and Large with Default chosen', () => {
    renderSettings();

    expect(radios().map((radio) => radio.textContent)).toEqual([
      'AaSmallFits more',
      'AaDefaultThe usual size',
      'AaLargeEasier to read',
    ]);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(
      ['false', 'true', 'false']
    );
  });

  it('applies a choice at once, to the preview too', () => {
    const store = renderSettings();
    const preview = screen.getByRole('group', { name: 'Preview' });
    expect(preview).toHaveClass('reticulum-chat-text-scale--default');

    fireEvent.click(screen.getByRole('radio', { name: /Large/ }));

    expect(store.get(reticulumChatTextScaleAtom)).toBe('large');
    expect(screen.getByRole('radio', { name: /Large/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(preview).toHaveClass('reticulum-chat-text-scale--large');
    expect(within(preview).getByText('Alice')).toBeInTheDocument();
    expect(
      within(preview).getByText('Is this text easy to read?')
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toBe(
      'large'
    );

    fireEvent.click(screen.getByRole('radio', { name: /Small/ }));
    expect(preview).toHaveClass('reticulum-chat-text-scale--small');
  });

  it('shows an older build’s Medium as Large', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('medium'));
    renderSettings();

    expect(screen.getByRole('radio', { name: /Large/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('draws each sample at its own size', () => {
    renderSettings();

    const sizes = radios().map(
      (radio) => getComputedStyle(radio.firstElementChild as Element).fontSize
    );
    expect(sizes).toEqual(['14px', '16px', '19px']);
  });
});
