import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { suggestSlug } from './slug.ts';

describe('suggestSlug', () => {
  it('кавычки и служебные слова уходят, кириллица — латиницей', () => {
    assert.equal(suggestSlug('КНТ «Столбы»'), 'stolby');
    assert.equal(suggestSlug('АНТ «Енисей»'), 'enisey');
    assert.equal(suggestSlug('Клуб «Шахматы и щи» 2'), 'shakhmaty-i-shchi-2');
  });

  it('одни служебные слова — тогда они', () => {
    assert.equal(suggestSlug('Клуб настольного тенниса'), 'klub-nastolnogo-tennisa');
  });
});
