import { SpinService } from './spin.service';

describe('SpinService', () => {
  let service: SpinService;

  beforeEach(() => {
    service = new SpinService();
  });

  describe('detectSpin', () => {
    it('should return true for content with spin syntax', () => {
      expect(service.detectSpin('{A|B}')).toBe(true);
      expect(service.detectSpin('Hello {World|Earth}')).toBe(true);
      expect(service.detectSpin('{A|B|C|D}')).toBe(true);
    });

    it('should return false for content without spin syntax', () => {
      expect(service.detectSpin('hello')).toBe(false);
      expect(service.detectSpin('no spin here')).toBe(false);
      expect(service.detectSpin('{single}')).toBe(false);
    });
  });

  describe('resolveSpin', () => {
    it('should resolve spin syntax to one of the options', () => {
      const result = service.resolveSpin('{A|B}');
      expect(['A', 'B']).toContain(result);
    });

    it('should resolve multiple spin groups', () => {
      const result = service.resolveSpin('{Hi|Hello} {World|Earth}');
      const parts = result.split(' ');
      expect(['Hi', 'Hello']).toContain(parts[0]);
      expect(['World', 'Earth']).toContain(parts[1]);
    });

    it('should leave non-spin content unchanged', () => {
      expect(service.resolveSpin('no spin')).toBe('no spin');
    });
  });

  describe('resolveVariables', () => {
    it('should replace known variables', () => {
      const result = service.resolveVariables('Ola {{nome}}!', {
        nome: 'Maria',
      });
      expect(result).toBe('Ola Maria!');
    });

    it('should replace unknown variables with empty string', () => {
      const result = service.resolveVariables('Ola {{nome}}!', {});
      expect(result).toBe('Ola !');
    });

    it('should replace multiple variables', () => {
      const result = service.resolveVariables(
        '{{nome}} - {{telefone}}',
        { nome: 'Joao', telefone: '31999999999' },
      );
      expect(result).toBe('Joao - 31999999999');
    });
  });

  describe('addZeroWidthFingerprint', () => {
    it('should return a string with different byte length', () => {
      const input = 'Hello World';
      const result = service.addZeroWidthFingerprint(input);
      expect(result.length).toBeGreaterThan(input.length);
    });
  });

  describe('processMessage', () => {
    it('should return a non-empty string', () => {
      const result = service.processMessage(
        '{Ola|Ei} {{nome}}!',
        { nome: 'Ana' },
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('Ana');
    });
  });
});
