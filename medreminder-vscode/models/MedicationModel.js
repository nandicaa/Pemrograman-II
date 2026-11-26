// ============================================================
// 1. INTERFACE & ABSTRACT CLASS
// ============================================================

/**
 * Interface kontrak untuk entitas yang dapat dijadwalkan (Schedulable)
 * @interface ISchedulable
 */
class ISchedulable {
  getNextDoseTime() {
    throw new Error("Method 'getNextDoseTime()' wajib diimplementasikan.");
  }

  validateSchedule() {
    throw new Error("Method 'validateSchedule()' wajib diimplementasikan.");
  }
}

/**
 * Abstract Class dasar untuk semua item medis di MedReminder
 * @abstract
 */
class BaseMedicalItem extends ISchedulable {
  constructor(id, name) {
    super();
    if (this.constructor === BaseMedicalItem) {
      throw new Error("Abstract class 'BaseMedicalItem' tidak boleh diinstansiasi langsung.");
    }
    this._id = id;
    this._name = name;
  }

  // Abstract method
  getSummary() {
    throw new Error("Abstract method 'getSummary()' harus di-override oleh subclass.");
  }
}

// ============================================================
// 2. VARIABLE, GETTER, SETTER, METHOD & 3. INHERITANCE
// ============================================================

/**
 * Subclass Medication mewarisi BaseMedicalItem (Inheritance)
 */
class Medication extends BaseMedicalItem {
  // Private variable
  #stock;

  constructor(id, name, dosage, stock, intervalHours) {
    super(id, name);
    this._dosage = dosage;
    this.#stock = stock;
    this._intervalHours = intervalHours;
  }

  // Getter & Setter
  get stock() {
    return this.#stock;
  }

  set stock(value) {
    if (value < 0) {
      throw new Error("Stok obat tidak boleh negatif.");
    }
    this.#stock = value;
  }

  get name() {
    return this._name;
  }

  set name(newName) {
    if (!newName || newName.trim() === "") {
      throw new Error("Nama obat tidak boleh kosong.");
    }
    this._name = newName.trim();
  }

  // Method biasa
  consumeDose(amount = 1) {
    if (this.#stock < amount) {
      throw new Error(`Stok ${this._name} tidak mencukupi.`);
    }
    this.stock = this.#stock - amount;
    return this.#stock;
  }

  // Implementasi Interface & Override Abstract Method
  validateSchedule() {
    return this._intervalHours > 0 && this.#stock > 0;
  }

  getNextDoseTime() {
    const next = new Date();
    next.setHours(next.getHours() + this._intervalHours);
    return next.toISOString();
  }

  getSummary() {
    return `${this._name} (${this._dosage}) - Sisa stok: ${this.#stock}`;
  }
}

// ============================================================
// 4. COLLECTION, DICTIONARY & GENERIC
// ============================================================

/**
 * Generic Repository untuk mengelola koleksi data bertipe T
 * @template T
 */
class GenericRepository {
  constructor() {
    /** @type {T[]} Collection (Array List) */
    this.items = [];

    /** @type {Map<string, T>} Dictionary (Key-Value Map) */
    this.dictionary = new Map();
  }

  /**
   * Menambahkan item bertipe T ke Collection dan Dictionary
   * @param {string} key
   * @param {T} item
   */
  add(key, item) {
    this.items.push(item);
    this.dictionary.set(key, item);
  }

  /**
   * Mengambil item dari Dictionary berdasarkan key
   * @param {string} key
   * @returns {T | undefined}
   */
  getByKey(key) {
    return this.dictionary.get(key);
  }

  /**
   * Mengembalikan seluruh Collection
   * @returns {T[]}
   */
  getAll() {
    return [...this.items];
  }
}

module.exports = {
  ISchedulable,
  BaseMedicalItem,
  Medication,
  GenericRepository,
};