import { IsOptional, IsString, validate } from 'class-validator';
import { IsOnOrBefore } from './is-on-or-before.validator';

class DateRangeFixture {
  @IsOptional()
  @IsString()
  @IsOnOrBefore('to')
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

function build(from?: string, to?: string): DateRangeFixture {
  const fixture = new DateRangeFixture();
  fixture.from = from;
  fixture.to = to;
  return fixture;
}

describe('IsOnOrBefore', () => {
  it('passes when from is before to', async () => {
    const errors = await validate(build('2026-09-01', '2026-09-15'));
    expect(errors).toHaveLength(0);
  });

  it('passes when from equals to', async () => {
    const errors = await validate(build('2026-09-15', '2026-09-15'));
    expect(errors).toHaveLength(0);
  });

  it('fails when from is after to', async () => {
    const errors = await validate(build('2026-09-20', '2026-09-15'));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('from');
  });

  it('passes when only from is present', async () => {
    const errors = await validate(build('2026-09-01', undefined));
    expect(errors).toHaveLength(0);
  });

  it('passes when only to is present', async () => {
    const errors = await validate(build(undefined, '2026-09-01'));
    expect(errors).toHaveLength(0);
  });

  it('passes when neither is present', async () => {
    const errors = await validate(build(undefined, undefined));
    expect(errors).toHaveLength(0);
  });
});
