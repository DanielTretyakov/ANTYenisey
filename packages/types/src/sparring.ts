/**
 * Типы спаррингов (решение владельца от 26.09.2026): конструктор у клуба,
 * тренер выбирает тип, записывая ученика, и ученик платит цену типа — стол
 * входит в неё. Абонементом спарринг не оплачивается.
 */

export interface SparringType {
  id: string;
  name: string;
  /** Цена часа, копейки. Спарринг другой длины — пропорционально. */
  hourPrice: number;
  /** Возраст ученика в полных годах на день спарринга; пусто — без предела. */
  minAge: number | null;
  maxAge: number | null;
  description: string | null;
  /** Снятый тип тренеру не предлагается, но на старых бронях остаётся. */
  isActive: boolean;
}

export interface SparringTypeRequest {
  name: string;
  hourPrice: number;
  minAge?: number | null;
  maxAge?: number | null;
  description?: string | null;
  isActive?: boolean;
}

/**
 * Ученик для спарринга — из поиска тренера. Полное имя, как в составе групп:
 * тренеру звонить ученику. Возраст — чтобы выбрать тип.
 */
export interface SparringStudent {
  id: string;
  fullName: string;
  age: number;
}
