import { Injectable } from '@angular/core';
import { SkyIntlNumberFormatStyle, SkyLibResourcesService } from '@skyux/i18n';

import { SkyNumberFormatUtility } from '../shared/number-format/number-format-utility';

import { SkyNumericSymbol } from './numeric-symbol';
import { SkyNumericOptions } from './numeric.options';

@Injectable({
  providedIn: 'root',
})
export class SkyNumericService {
  /**
   * The browser's current locale.
   * @internal
   */
  public currentLocale = 'en-US';

  /**
   * @internal
   */
  public shortSymbol = '';

  #resourcesSvc: SkyLibResourcesService;

  #symbolIndex: SkyNumericSymbol[];

  constructor(resourcesSvc: SkyLibResourcesService) {
    this.#resourcesSvc = resourcesSvc;

    this.#symbolIndex = [
      { value: 1e12, label: this.#getSymbol('skyux_numeric_trillions_symbol') },
      { value: 1e9, label: this.#getSymbol('skyux_numeric_billions_symbol') },
      { value: 1e6, label: this.#getSymbol('skyux_numeric_millions_symbol') },
      { value: 1e3, label: this.#getSymbol('skyux_numeric_thousands_symbol') },
    ];
  }

  /**
   * Formats a number based on the provided options.
   * @param value The number to format.
   * @param options Format options.
   */
  public formatNumber(
    value: number | undefined | null,
    options: SkyNumericOptions,
  ): string {
    if (value === undefined || value === null || isNaN(value)) {
      return '';
    }

    const numericOptions: SkyNumericOptions = {
      digits: 0,
      format: 'number',
      currencySign: 'standard',
      iso: 'USD',
      truncateAfter: 1000,
      ...options,
    };

    const decimalPlaceRegExp = /\.0+$|(\.[0-9]*[1-9])0+$/;
    const locale = numericOptions.locale || this.currentLocale;
    const digits = numericOptions.digits || 0;

    // Get the symbol for the number after rounding, since rounding could push the number
    // into a different symbol range.
    let roundedNumber = this.#roundNumber(value, digits);
    const roundedNumberAbs = Math.abs(roundedNumber);

    let suffix = '';

    for (let i = 0; i < this.#symbolIndex.length; i++) {
      let symbol = this.#symbolIndex[i];

      if (
        numericOptions.truncate &&
        numericOptions.truncateAfter !== undefined &&
        roundedNumberAbs >= numericOptions.truncateAfter &&
        roundedNumberAbs >= symbol.value
      ) {
        roundedNumber = this.#roundNumber(value / symbol.value, digits);

        if (Math.abs(roundedNumber) === 1000 && i > 0) {
          // Rounding caused the number to cross into the range of the next symbol.
          symbol = this.#symbolIndex[i - 1];
          roundedNumber /= 1000;
        }

        suffix = symbol.label;

        break;
      }
    }

    let output: string =
      roundedNumber.toString().replace(decimalPlaceRegExp, '$1') + suffix;

    this.#storeShortenSymbol(output);

    let digitsFormatted: string | undefined;
    let isDecimal = false;

    // Checks the string entered for format. Using toLowerCase to ignore case.
    switch (numericOptions.format?.toLowerCase()) {
      // In a case where a decimal value was not shortened and
      // the digit input is 2 or higher, it forces 2 digits.
      // For example, this prevents a value like $15.50 from displaying as $15.5.
      // Note: This will need to be reviewed if we support currencies with
      // three decimal digits.
      case 'currency':
        isDecimal = value % 1 !== 0;

        if (numericOptions.minDigits) {
          digitsFormatted = `1.${numericOptions.minDigits}-${digits}`;
        } else if (isDecimal && digits >= 2) {
          digitsFormatted = `1.2-${digits}`;
        } else {
          digitsFormatted = `1.0-${digits}`;
        }

        output = SkyNumberFormatUtility.formatNumber(
          locale,
          parseFloat(output),
          SkyIntlNumberFormatStyle.Currency,
          digitsFormatted,
          numericOptions.iso,
          numericOptions.currencyDisplay ?? 'symbol',
          numericOptions.currencySign,
        ) as string;
        //   ^^^^^^ Result can't be null since the sanitized input is always a number.
        break;

      // The following is a catch-all to ensure that if
      // anything but currency (or a future option) are entered,
      // it will be treated like a number.
      default:
        // Ensures localization of the number to ensure comma and
        // decimal separator
        if (numericOptions.minDigits) {
          digitsFormatted = `1.${numericOptions.minDigits}-${digits}`;
        } else if (numericOptions.truncate) {
          digitsFormatted = `1.0-${digits}`;
        } else {
          digitsFormatted = `1.${digits}-${digits}`;
        }

        output = SkyNumberFormatUtility.formatNumber(
          locale,
          parseFloat(output),
          SkyIntlNumberFormatStyle.Decimal,
          digitsFormatted,
        ) as string;
        //   ^^^^^^ Result can't be null since the sanitized input is always a number.
        break;
    }

    if (numericOptions.truncate) {
      output = this.#replaceShortenSymbol(output);
    }

    return output;
  }

  /**
   * Rounds a given number
   *
   * JS's limitation - numbers bigger than Number.MIN_SAFE_INTEGER or Number.MAX_SAFE_INTEGER
   * are not guaranteed to be represented or rounded correctly
   * @param value - value to round
   * @param precision - what precision to round with, defaults to 0 decimal places
   */
  #roundNumber(value: number, precision: number): number {
    if (precision < 0) {
      throw new Error('SkyInvalidArgument: precision must be >= 0');
    }

    /* Sanity check - ignoring coverage but should not ignore if we make this method public */
    /* istanbul ignore next */
    if (isNaN(value) || value === null) {
      return 0;
    }

    const scaledValue: number = this.#scaleNumberByPowerOfTen(
      value,
      precision,
      true,
    );
    const scaledRoundedValue: number = Math.round(scaledValue);
    const unscaledRoundedValue: number = this.#scaleNumberByPowerOfTen(
      scaledRoundedValue,
      precision,
      false,
    );

    return unscaledRoundedValue;
  }

  /**
   * Scales a given number by a power of 10
   * @param value - value to scale
   * @param scalar - 10^scalar
   * @param scaleUp - whether to increase or decrease the value
   */
  #scaleNumberByPowerOfTen(
    value: number,
    scalar: number,
    scaleUp: boolean,
  ): number {
    const valueStr: string = value.toString().toLowerCase();
    const isExponentFormat: boolean = valueStr.includes('e');

    if (isExponentFormat) {
      const [base, exp] = valueStr.split('e');
      const newExp = scaleUp ? Number(exp) + scalar : Number(exp) - scalar;
      return Number(`${base}e${newExp}`);
    } else {
      const e = scaleUp ? 'e' : 'e-';
      return Number(`${value}${e}${scalar}`);
    }
  }

  /**
   * Stores the symbol added from shortening to reapply later.
   * @param value The string to derive the shorten symbol from.
   */
  #storeShortenSymbol(value: string): void {
    const symbols: string[] = this.#symbolIndex.map((s) => s.label);
    const regexp = new RegExp(symbols.join('|'), 'ig');
    const match = value.match(regexp);
    this.shortSymbol = match ? match.toString() : '';
  }

  /**
   * Must have previously called storeShortenSymbol to have something to replace.
   * Finds the last number in the formatted number, gets the index of the position
   * after that character and re-inserts the symbol.
   * Works regardless of currency symbol position.
   * @param value The string to modify.
   */
  #replaceShortenSymbol(value: string): string {
    const result = /(\d)(?!.*\d)/g.exec(value);
    /*istanbul ignore else*/
    if (result) {
      const pos = result.index + result.length;
      const output =
        value.substring(0, pos) + this.shortSymbol + value.substring(pos);

      return output;
    } else {
      return value;
    }
  }

  #getSymbol(key: string): string {
    // TODO: Need to implement the async `getString` method in a breaking change.
    return this.#resourcesSvc.getStringForLocale({ locale: 'en_US' }, key);
  }
}
