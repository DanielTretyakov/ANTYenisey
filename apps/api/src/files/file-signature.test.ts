import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkUpload, MAX_UPLOAD_BYTES, sniffContentType } from './file-signature.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = text('RIFF\x24\x00\x00\x00WEBPVP8 ');
const PDF = text('%PDF-1.7\n');

describe('sniffContentType', () => {
  it('узнаёт четыре принятых формата по сигнатуре', () => {
    assert.equal(sniffContentType(JPEG), 'image/jpeg');
    assert.equal(sniffContentType(PNG), 'image/png');
    assert.equal(sniffContentType(WEBP), 'image/webp');
    assert.equal(sniffContentType(PDF), 'application/pdf');
  });

  it('SVG — не картинка, а код', () => {
    assert.equal(sniffContentType(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
    assert.equal(sniffContentType(text('<?xml version="1.0"?><svg/>')), null);
  });

  it('HTML с чужим заголовком не проходит', () => {
    assert.equal(sniffContentType(text('<!doctype html><script>alert(1)</script>')), null);
  });

  it('RIFF без WEBP — это WAV или AVI, а не картинка', () => {
    assert.equal(sniffContentType(text('RIFF\x24\x00\x00\x00WAVEfmt ')), null);
  });

  it('GIF не принимается', () => {
    assert.equal(sniffContentType(text('GIF89a')), null);
  });

  it('обрывок сигнатуры — не файл', () => {
    assert.equal(sniffContentType(bytes(0x89, 0x50, 0x4e)), null);
    assert.equal(sniffContentType(text('RIFF')), null);
    assert.equal(sniffContentType(new Uint8Array()), null);
  });
});

describe('checkUpload', () => {
  it('аватар — только картинка', () => {
    assert.deepEqual(checkUpload('AVATAR', PNG), { ok: true, contentType: 'image/png' });

    const pdf = checkUpload('AVATAR', PDF);
    assert.equal(pdf.ok, false);
  });

  it('приказ — картинка или PDF', () => {
    assert.deepEqual(checkUpload('RANK_DOCUMENT', PDF), { ok: true, contentType: 'application/pdf' });
    assert.deepEqual(checkUpload('RANK_DOCUMENT', JPEG), { ok: true, contentType: 'image/jpeg' });
  });

  it('лимит своего вида: аватар до 5 МБ, приказ до 10', () => {
    const six = new Uint8Array(6 * 1024 * 1024);
    six.set(JPEG);

    const avatar = checkUpload('AVATAR', six);
    assert.equal(avatar.ok, false);
    assert.equal(!avatar.ok && avatar.message, 'Файл больше 5 МБ');

    assert.equal(checkUpload('RANK_DOCUMENT', six).ok, true);
  });

  it('пустой файл', () => {
    assert.deepEqual(checkUpload('RANK_DOCUMENT', new Uint8Array()), { ok: false, message: 'Файл пустой' });
  });

  it('потолок разбора запроса — самый щедрый вид', () => {
    assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
  });
});
