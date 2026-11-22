import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import {
  DASHBOARD_WIDGET_FRAME_CHROME_PX,
  DashboardWidgetFrame,
} from './DashboardWidgetFrame';

const theme = createTheme({ palette: { border: { main: '#888' } } as any });
const renderFrame = (props: { top?: ReactNode; children?: ReactNode }) =>
  render(
    <ThemeProvider theme={theme}>
      <DashboardWidgetFrame
        height={612}
        title="Torq Feed"
        widgetId="w"
        {...props}
      />
    </ThemeProvider>
  );
const frame = () => document.querySelector('[data-widget-id="w"]')!;

describe('DashboardWidgetFrame', () => {
  it('is as tall as its height, the content filling it', () => {
    renderFrame({ children: <div data-testid="content" /> });
    expect(frame()).toHaveStyle({ height: '612px' });
    expect(screen.getByTestId('content').parentElement).toHaveStyle({
      flex: '1 1 auto',
    });
  });

  it('grows by what is on top, the content keeping its room', () => {
    renderFrame({
      top: <div data-testid="top" />,
      children: <div data-testid="content" />,
    });
    expect(frame()).toHaveStyle({ height: 'auto' });
    expect(screen.getByTestId('content').parentElement).toHaveStyle({
      height: `${612 - DASHBOARD_WIDGET_FRAME_CHROME_PX}px`,
    });
    // On top of the content, under the title.
    const top = screen.getByTestId('top');
    expect(
      top.compareDocumentPosition(screen.getByTestId('content')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByText('Torq Feed').compareDocumentPosition(top) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('can be a title and its top alone', () => {
    renderFrame({ top: <div data-testid="top" /> });
    expect(screen.getByTestId('top')).toBeInTheDocument();
    expect(frame().children).toHaveLength(2);
  });
});
