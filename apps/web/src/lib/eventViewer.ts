'use client';

import { useCallback, useState } from 'react';
import type { ClubEvent } from '@yenisey/types';
import { ApiError, clubApi } from './api';
import { roleInClub } from './membership';
import type { SessionState } from './useSession';

/**
 * Кем человек приходится клубу — с точки зрения кнопки «Записаться».
 *
 * `child` — вошедшему нет 16, и он смотрит сам за себя: записывает его
 * родитель или администратор у стойки.
 */
export type EventViewer = 'anonymous' | 'client' | 'staff' | 'child';

/**
 * Кто смотрит на мероприятие клуба `slug`.
 *
 * Одно правило на страницу клуба и окно мероприятия: окно открывается и со
 * стартовой, где клуба в адресе нет, и разойдись они — кнопка «Записаться»
 * на стартовой вела бы сотрудника к «Недостаточно прав».
 *
 * `staff` — сотрудник ЭТОГО клуба: администратор, владелец или тренер.
 * Записаться на мероприятие он не может: запись ссылается на карточку
 * клиента, а его роль в этом клубе другая. Человек без привязки проходит как
 * клиент — вступать заранее не нужно.
 *
 * За выбранного ребёнка родитель — всегда клиент, даже если сам он тренер
 * этого клуба: право на запись проверяется у того, за кого пишут (решение
 * от 17.09.2026). Сотрудником ребёнка сервер всё равно не пропустит.
 */
export function eventViewerOf(
  session: SessionState,
  slug: string,
  forPerson: string | null,
  selfIsChild: boolean,
): EventViewer {
  if (session.status !== 'ready') return 'anonymous';
  if (forPerson) return 'client';
  if ((roleInClub(session.user, slug) ?? 'CLIENT') !== 'CLIENT') return 'staff';

  return selfIsChild ? 'child' : 'client';
}

/**
 * Запись на мероприятие и её отмена — одна на строку списка и окно.
 *
 * Маршрут выбирается по виду: занятия и турниры лежат в разных таблицах, и
 * «мероприятие вообще» — понятие интерфейса, а не базы.
 */
export function useEventAction(slug: string, forPerson: string | null, onChanged: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (event: Pick<ClubEvent, 'id' | 'kind' | 'registered'>): Promise<void> => {
      const club = clubApi(slug);

      setPending(true);
      setError(null);

      try {
        if (event.kind === 'TRAINING') {
          await (event.registered
            ? club.cancelTrainingBooking(event.id, forPerson)
            : club.registerForTraining(event.id, forPerson));
        } else {
          await (event.registered
            ? club.cancelTournamentRegistration(event.id, forPerson)
            : club.registerForTournament(event.id, forPerson));
        }

        onChanged();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Сервис недоступен');
      } finally {
        setPending(false);
      }
    },
    [slug, forPerson, onChanged],
  );

  return { toggle, pending, error };
}

/**
 * Сколько занято и сколько осталось.
 *
 * У турнира лимита мест нет — там остаётся только число записавшихся. Ноль
 * показывается словом: «0 записавшихся» читается как ошибка, а не как пустое
 * занятие.
 */
export function seatsLabel(event: Pick<ClubEvent, 'freeSeats' | 'registeredCount' | 'capacity'>): string {
  if (event.freeSeats === null) {
    return event.registeredCount === 0 ? 'Пока никто не записался' : `Записались: ${event.registeredCount}`;
  }

  if (event.freeSeats === 0) {
    return 'Мест нет';
  }

  return `Осталось ${event.freeSeats} из ${event.capacity}`;
}
