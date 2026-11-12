import { AiEmbeddingChunk } from '../../models/ai/ai-embedding.model.js';
import mongoose from 'mongoose';
export interface VectorVersion {
  _id: string;
  indexName: string;
  dimensions: number;
}
// Exact cosine search is intended for small stores. Never silently scan a
// partial corpus; larger stores must use the Atlas backend.
export const EXACT_VECTOR_LIMIT = 5000;
export class ExactVectorCapacityError extends Error {}
export function isExactVectorIndex(name: string) {
  return name.startsWith('ai_exact_');
}
export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) return -Infinity;
  let dot = 0,
    a = 0,
    b = 0;
  for (let i = 0; i < left.length; i++) {
    const x = left[i]!,
      y = right[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -Infinity;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return a && b ? dot / Math.sqrt(a * b) : -Infinity;
}
export async function exactVectorMatches(
  generation: string,
  vector: number[],
  signal?: AbortSignal
) {
  const matches: {
    key: string;
    part: number;
    hash: string;
    text: string;
    title: string;
    href: string;
    score: number;
  }[] = [];
  const cursor = AiEmbeddingChunk.find({ generation, verified: true })
    .select('key part hash text title href +embedding')
    .limit(EXACT_VECTOR_LIMIT + 1)
    .maxTimeMS(5000)
    .setOptions(signal ? { signal } : {})
    .lean()
    .cursor({ batchSize: 50 });
  let count = 0;
  try {
    for await (const chunk of cursor) {
      signal?.throwIfAborted();
      if (++count > EXACT_VECTOR_LIMIT)
        throw new ExactVectorCapacityError('Exact vector capacity exceeded');
      const score = cosineSimilarity(vector, chunk.embedding);
      if (!Number.isFinite(score)) continue;
      const { key, part, hash, text, title, href } = chunk;
      matches.push({
        key,
        part,
        hash,
        text,
        title: title ?? '',
        href: href ?? '',
        score,
      });
      matches.sort(
        (a, b) =>
          b.score - a.score || a.key.localeCompare(b.key) || a.part - b.part
      );
      if (matches.length > 40) matches.pop();
    }
  } finally {
    await cursor.close();
  }
  return matches;
}
export class VectorIndexPending extends Error {
  constructor() {
    super('Vector index is not queryable yet');
  }
}
export function vectorDefinition(dimensions: number) {
  return {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: dimensions,
        similarity: 'cosine',
      },
      { type: 'filter', path: 'generation' },
      { type: 'filter', path: '_id' },
      { type: 'filter', path: 'hash' },
    ],
  };
}
export function compatibleVectorIndex(
  index: Record<string, unknown>,
  dimensions: number
) {
  const definition = index['latestDefinition'] ?? index['definition'];
  if (
    !definition ||
    typeof definition !== 'object' ||
    !('fields' in definition) ||
    !Array.isArray(definition.fields)
  )
    return false;
  const fields = definition.fields as Record<string, unknown>[];
  return (
    fields.some(
      (f) =>
        f['type'] === 'vector' &&
        f['path'] === 'embedding' &&
        f['numDimensions'] === dimensions &&
        f['similarity'] === 'cosine'
    ) &&
    ['generation', '_id', 'hash'].every((path) =>
      fields.some((f) => f['type'] === 'filter' && f['path'] === path)
    )
  );
}
export const vectorInfrastructure = {
  async ensure(version: VectorVersion, create = false): Promise<string> {
    if (isExactVectorIndex(version.indexName)) {
      // Persisted version identity, independent of Atlas search processes.
      return `exact:${version._id}:${version.dimensions}`;
    }
    const collection = mongoose.connection.db!.collection(
      'ai_embedding_chunks'
    );
    if (create) {
      try {
        await AiEmbeddingChunk.createCollection();
      } catch (e) {
        if (!(e && typeof e === 'object' && 'code' in e && e.code === 48))
          throw e;
      }
    }
    const indexes = await collection
      .listSearchIndexes(version.indexName)
      .toArray();
    const index: Record<string, unknown> | undefined = indexes[0];
    if (!index) {
      if (create)
        await collection.createSearchIndex({
          name: version.indexName,
          type: 'vectorSearch',
          definition: vectorDefinition(version.dimensions),
        });
      throw new VectorIndexPending();
    }
    if (!compatibleVectorIndex(index, version.dimensions))
      throw new Error('Incompatible vector index definition');
    if (index['queryable'] !== true || !index['id'])
      throw new VectorIndexPending();
    return String(index['id']);
  },
  async visible(
    version: VectorVersion,
    chunk: { _id: mongoose.Types.ObjectId; embedding: number[]; hash: string }
  ) {
    if (isExactVectorIndex(version.indexName)) {
      const stored = await AiEmbeddingChunk.findOne({
        _id: chunk._id,
        generation: version._id,
        hash: chunk.hash,
      })
        .select('+embedding')
        .lean();
      return (
        !!stored &&
        stored.embedding.length === version.dimensions &&
        Number.isFinite(cosineSimilarity(stored.embedding, chunk.embedding))
      );
    }
    const rows = await AiEmbeddingChunk.aggregate<{
      _id: mongoose.Types.ObjectId;
    }>([
      {
        $vectorSearch: {
          index: version.indexName,
          path: 'embedding',
          queryVector: chunk.embedding,
          exact: true,
          limit: 1,
          filter: {
            $and: [
              { generation: version._id },
              { _id: chunk._id },
              { hash: chunk.hash },
            ],
          },
        },
      },
      { $project: { _id: 1 } },
    ]).option({ maxTimeMS: 5000 });
    return rows.some((row) => String(row._id) === String(chunk._id));
  },
};
