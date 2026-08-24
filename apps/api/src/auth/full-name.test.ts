import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { joinFullName } from './full-name.ts';

describe('joinFullName', () => {
  it('склеивает в порядке «фамилия имя отчество»', () => {
    assert.equal(
      joinFullName({ lastName: 'Иванов', firstName: 'Пётр', middleName: 'Сергеевич' }),
      'Иванов Пётр Сергеевич',
    );
  });

  it('не оставляет двойных пробелов и краёв', () => {
    // Такая строка в базе сломала бы поиск администратора по клиентской базе.
    assert.equal(
      joinFullName({ lastName: '  Салтыков  Щедрин ', firstName: ' Иван', middleName: 'Ильич ' }),
      'Салтыков Щедрин Иван Ильич',
    );
  });

  it('сохраняет дефисы и апострофы внутри частей', () => {
    assert.equal(
      joinFullName({ lastName: 'Римский-Корсаков', firstName: "О'Нил", middleName: 'Ибн-Хаттаб' }),
      "Римский-Корсаков О'Нил Ибн-Хаттаб",
    );
  });
});
