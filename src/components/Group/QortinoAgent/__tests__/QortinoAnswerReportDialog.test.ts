import { describe, expect, it } from 'vitest';
import {
  buildTeachingQmailBody,
  formatAnswerReportMode,
  teachingBodyToHtml,
  QORTINO_TEACHING_RECIPIENT,
  QORTINO_TEACHING_SUBJECT,
} from '../QortinoAnswerReportDialog';

describe('Qortino answer report mail', () => {
  it('targets Qortino AI with the teaching subject', () => {
    expect(QORTINO_TEACHING_RECIPIENT).toBe('Qortino AI');
    expect(QORTINO_TEACHING_SUBJECT).toBe('Teaching Qortino AI');
  });

  it('converts the report body to Q-Mail HTML safely', () => {
    const html = teachingBodyToHtml(
      'Mode: OFFLINE · FAST\n\nQuestion:\nwhat is <b>qortal</b>?'
    );
    expect(html).toBe(
      '<p>Mode: OFFLINE · FAST</p><p>Question:<br>what is &lt;b&gt;qortal&lt;/b&gt;?</p>'
    );
  });

  it('labels the report with the offline model', () => {
    expect(formatAnswerReportMode({ model: 'Qwen3 4B Instruct 2507' })).toBe(
      'OFFLINE · Qwen3 4B Instruct 2507'
    );
  });

  it('packs mode, question, answer, and single feedback field', () => {
    const body = buildTeachingQmailBody({
      question: 'who is Kitty',
      answer: 'Qortal Kitty is…',
      mode: 'OFFLINE · Qwen3 4B Instruct 2507',
      feedback: 'Wrong person — use exact Kitty next time',
    });
    expect(body).toContain('Mode: OFFLINE · Qwen3 4B Instruct 2507');
    expect(body).toContain('Question:\nwho is Kitty');
    expect(body).toContain("Qortino's answer:\nQortal Kitty is…");
    expect(body).toContain(
      'What went wrong and how Qortino should answer next time:\nWrong person — use exact Kitty next time'
    );
    expect(body).not.toContain('How Qortino should answer next time:\n');
  });
});
