import assert from 'node:assert/strict';
import { buildArrangementDirective, buildPhraseDevelopmentDirective } from '../lib/arrangement-directive.mjs';

const drop8 = buildArrangementDirective('drop', 8, ['bassline', 'lead', 'pad-textures', 'plucks']);
assert.match(drop8, /bars 1-2 start with sustained\/harmonic layers/);
assert.match(drop8, /bars 3-4 introduce rhythmic layers during the build/);
assert.match(drop8, /bars 5-8 bring in full bass and lead/);
assert.match(drop8, /Develop lead motifs over sustained layers; stagger supporting fills\./);

const drop4 = buildArrangementDirective('drop', 4, ['bassline', 'melody']);
assert.match(drop4, /bar 1 start sparse/);
assert.match(drop4, /bars 3-4 bring in full bass and lead/);

assert.match(buildArrangementDirective('build', 8, ['arpeggio']), /progressively/);
assert.match(buildArrangementDirective('intro', 4, ['pad-textures']), /gradually/);
assert.match(buildArrangementDirective('bridge', 8, ['lead']), /harmonic continuity/);
assert.match(buildArrangementDirective('chorus', 8, ['lead']), /clear hook/);
assert.equal(buildArrangementDirective('verse', 8, ['bassline']), '');

assert.match(buildPhraseDevelopmentDirective(['bassline', 'guitar', 'brass']), /Interlock bass\/guitar; use brass call-response/);
assert.match(buildPhraseDevelopmentDirective(['brass', 'guitar']), /brass call-response with guitar/);
assert.match(buildPhraseDevelopmentDirective(['bassline', 'arpeggio']), /complementary; vary accents/);
assert.match(buildPhraseDevelopmentDirective(['strings', 'pad-textures']), /Repeat core motifs/);

console.log('arrangement and phrase-development directives: all tests passed');
