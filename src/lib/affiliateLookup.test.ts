import { describe, it, expect } from 'vitest';
import { findAffiliateInList } from './affiliateLookup';

// Scan PURO do fallback de fetchAffiliateById: varre a lista completa da API
// quando o mirror local 404a. Casa por `id` ou `_id`, coage number→string e
// nunca lança (lista inválida/vazia/sem match → null). R19.
describe('findAffiliateInList', () => {
  it('acha o afiliado por a.id', () => {
    const lista = [{ id: 'a1', nome: 'Ana' }, { id: 'a2', nome: 'Bia' }];
    expect(findAffiliateInList(lista, 'a2')).toEqual({ id: 'a2', nome: 'Bia' });
  });

  it('acha por a._id quando o item não tem a.id (API varia o nome do campo)', () => {
    const lista = [{ _id: 'b1', nome: 'Caio' }, { _id: 'b2', nome: 'Duda' }];
    expect(findAffiliateInList(lista, 'b2')).toEqual({ _id: 'b2', nome: 'Duda' });
  });

  it('coage id number da lista vs string buscada ({id: 123} casa com "123")', () => {
    const lista = [{ id: 123, nome: 'Eva' }];
    expect(findAffiliateInList(lista, '123')).toEqual({ id: 123, nome: 'Eva' });
  });

  it('retorna null quando ninguém casa', () => {
    const lista = [{ id: 'a1' }, { id: 'a2' }];
    expect(findAffiliateInList(lista, 'inexistente')).toBeNull();
  });

  it('retorna null para lista não-array (null/undefined) — nunca lança', () => {
    expect(findAffiliateInList(null as any, 'x')).toBeNull();
    expect(findAffiliateInList(undefined as any, 'x')).toBeNull();
  });

  it('retorna null para lista vazia', () => {
    expect(findAffiliateInList([], 'x')).toBeNull();
  });
});
