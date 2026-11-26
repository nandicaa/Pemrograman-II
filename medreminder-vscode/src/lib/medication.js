const { addDays, intervalText } = require('./schedule');

const MEDICATION_CONTRACT = Object.freeze({
  properties: ['name', 'stock'],
  methods: ['toJSON'],
});

function assertImplements(value, contract) {
  for (const property of contract.properties) {
    if (!(property in value)) {
      throw new TypeError(`Medication contract requires property "${property}".`);
    }
  }
  for (const method of contract.methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`Medication contract requires method "${method}".`);
    }
  }
  return value;
}

class AbstractMedication {
  constructor(data) {
    if (new.target === AbstractMedication) {
      throw new TypeError('AbstractMedication cannot be instantiated directly.');
    }
    this._data = { ...data };
  }

  get name() {
    return this._data.name;
  }

  set name(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError('Medication name must be a non-empty string.');
    }
    this._data.name = value.trim();
  }

  get stock() {
    return this._data.stock;
  }

  set stock(value) {
    const stock = Number(value);
    if (!Number.isFinite(stock) || stock < 0) {
      throw new TypeError('Medication stock must be a non-negative number.');
    }
    this._data.stock = stock;
  }

  toJSON() {
    throw new Error('Subclasses must implement toJSON().');
  }
}

class Medication extends AbstractMedication {
  toJSON() {
    assertImplements(this, MEDICATION_CONTRACT);
    const medication = this._data;
    const perDay = medication.times_per_day * medication.qty_per_dose;
    return {
      id: medication.id,
      name: this.name,
      type: medication.type,
      unit: medication.unit,
      note: medication.note,
      rule: `${medication.times_per_day}x${String(medication.qty_per_dose).replace('.', ',')}`,
      times_per_day: medication.times_per_day,
      qty_per_dose: medication.qty_per_dose,
      interval: intervalText(medication.times_per_day),
      first_time: medication.first_time,
      schedule_times: medication.schedule_times.split(','),
      duration_days: medication.duration_days,
      start_date: medication.start_date,
      end_date: addDays(medication.start_date, medication.duration_days - 1),
      stock: this.stock,
      min_stock: medication.min_stock,
      low_stock: this.stock <= medication.min_stock,
      days_left: perDay ? Math.floor(this.stock / perDay) : null,
    };
  }
}

/**
 * @template T
 */
class Collection {
  /**
   * @param {T[]} items
   */
  constructor(items = []) {
    if (!Array.isArray(items)) {
      throw new TypeError('Collection items must be an array.');
    }
    this.items = [...items];
  }

  /**
   * @template U
   * @param {(item: T, index: number, items: T[]) => U} callback
   * @returns {U[]}
   */
  map(callback) {
    return this.items.map(callback);
  }
}

/**
 * @template K, V
 */
class Dictionary {
  /**
   * @param {Array<[K, V]>} entries
   */
  constructor(entries = []) {
    if (!Array.isArray(entries)) {
      throw new TypeError('Dictionary entries must be an array.');
    }
    this.items = new Map(entries);
  }

  /**
   * @param {K} key
   * @param {V} value
   * @returns {this}
   */
  set(key, value) {
    this.items.set(key, value);
    return this;
  }

  /**
   * @param {K} key
   * @returns {V | undefined}
   */
  get(key) {
    return this.items.get(key);
  }

  /**
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    return this.items.has(key);
  }

  /**
   * @returns {K[]}
   */
  keys() {
    return [...this.items.keys()];
  }
}

module.exports = { AbstractMedication, Medication, Collection, Dictionary };
