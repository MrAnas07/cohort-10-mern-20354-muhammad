'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const tagRepository = require('../../src/repositories/tag.repository');
const tagsService = require('../../src/services/tags.service');

const USER = '22222222-2222-4222-8222-222222222222';

describe('unit: tags service', () => {
  afterEach(() => sinon.restore());

  it('returns the repository rows as the endpoint 11 payload', async () => {
    const stub = sinon.stub(tagRepository, 'listWithCounts').resolves([
      { name: 'meetings', noteCount: 1 },
      { name: 'work', noteCount: 4 },
    ]);

    const tags = await tagsService.list(USER);

    expect(stub.calledOnceWith(USER)).to.be.true;
    expect(tags).to.deep.equal([
      { name: 'meetings', noteCount: 1 },
      { name: 'work', noteCount: 4 },
    ]);
  });

  it('returns an empty array when no tag is attached to a note', async () => {
    sinon.stub(tagRepository, 'listWithCounts').resolves([]);
    expect(await tagsService.list(USER)).to.deep.equal([]);
  });
});
