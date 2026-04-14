import { Injectable } from '@nestjs/common';

@Injectable()
export class SpinService {
  /**
   * Detect if content contains spin syntax {A|B|C}
   */
  detectSpin(content: string): boolean {
    return /\{[^{}]+\|[^{}]+\}/.test(content);
  }

  /**
   * Resolve all spin syntax in content, picking random variants.
   * Handles flat spin groups: {A|B|C} -> picks one at random.
   */
  resolveSpin(content: string): string {
    return content.replace(/\{([^{}]+)\}/g, (_, group: string) => {
      const options = group.split('|');
      return options[Math.floor(Math.random() * options.length)];
    });
  }

  /**
   * Replace variables: {{nome}}, {{telefone}}, {{email}}, etc.
   */
  resolveVariables(
    content: string,
    variables: Record<string, string>,
  ): string {
    return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return variables[key] ?? '';
    });
  }

  /**
   * Add invisible zero-width characters at random positions
   * to make each message unique at the byte level.
   */
  addZeroWidthFingerprint(content: string): string {
    const zwChars = ['\u200B', '\u200C', '\u200D', '\uFEFF'];
    const numInsertions = 1 + Math.floor(Math.random() * 3); // 1-3
    let result = content;

    for (let i = 0; i < numInsertions; i++) {
      const pos = Math.floor(Math.random() * result.length);
      const zwChar = zwChars[Math.floor(Math.random() * zwChars.length)];
      result = result.slice(0, pos) + zwChar + result.slice(pos);
    }

    return result;
  }

  /**
   * Vary punctuation randomly at end of sentences.
   */
  varyPunctuation(content: string): string {
    const endings = ['.', '!', '!!', ''];
    return content.replace(
      /([.!])(\s|$)/g,
      (match, _punct: string, space: string) => {
        if (Math.random() > 0.3) return match; // 70% keep original
        return endings[Math.floor(Math.random() * endings.length)] + space;
      },
    );
  }

  /**
   * Full spin pipeline:
   * resolve spin -> resolve variables -> fingerprint -> vary punctuation
   */
  processMessage(
    content: string,
    variables: Record<string, string>,
  ): string {
    let result = this.resolveSpin(content);
    result = this.resolveVariables(result, variables);
    result = this.addZeroWidthFingerprint(result);
    result = this.varyPunctuation(result);
    return result;
  }
}
