// Your songs: liked, played, best scores, parts learned.
//   node tests/library_check.mjs
const kept = new Map();
globalThis.localStorage = {
  getItem: (k) => (kept.has(k) ? kept.get(k) : null),
  setItem: (k, v) => kept.set(k, String(v)),
  removeItem: (k) => kept.delete(k),
};
const lib = await import('../js/library.js');

let failed = 0;
function check(what, ok, got) {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: got ${JSON.stringify(got)}`}`);
}

const everlong = { title: 'Everlong', artist: 'Foo Fighters', charts: [{ md5: 'aaa', name: 'Everlong', artist: 'Foo Fighters', charter: 'Harmonix', length: 250 }] };
const fromSpotify = { title: 'Everlong - Remastered 2011', artist: 'Foo Fighters, Someone Else', art: 'https://example.test/art.jpg', duration: 250 };

check('a song Spotify plays and the same song looked up are one song',
  lib.songKey(everlong.title, everlong.artist) === lib.songKey(fromSpotify.title, fromSpotify.artist));

check('nothing liked at first', lib.liked().length === 0);
lib.like(everlong);
check('liking a song keeps it', lib.liked().length === 1 && lib.isLiked('Everlong', 'Foo Fighters'));
check('...with its charts, so it opens without a search', lib.liked()[0].charts[0].md5 === 'aaa');
lib.remember(fromSpotify);
check('what Spotify knows is added to the same entry', lib.liked()[0].art === 'https://example.test/art.jpg' && lib.liked()[0].title === 'Everlong', lib.liked()[0]);

let changes = 0;
const stop = lib.onChange(() => changes++);
lib.like({ title: 'Du Hast', artist: 'Rammstein' });
check('the newest liked song comes first', lib.liked().map((e) => e.title).join() === 'Du Hast,Everlong', lib.liked().map((e) => e.title));
lib.like({ title: 'Du Hast', artist: 'Rammstein' }, false);
check('unliking takes it off the list', lib.liked().length === 1 && changes === 2, [lib.liked().length, changes]);
stop();

const first = lib.record(everlong, { score: 5000, accuracy: 0.81, combo: 40, mode: 'tab' });
check('a first run is your best', first.best && first.run.grade === 'B', first);
const worse = lib.record(everlong, { score: 4000, accuracy: 0.7, combo: 20, mode: 'tab' });
check('a worse run does not replace it', !worse.best && lib.find('Everlong', 'Foo Fighters').best.score === 5000);
const better = lib.record(everlong, { score: 9000, accuracy: 0.96, combo: 200, mode: 'mania' });
check('a better one does', better.best && better.previous.score === 5000 && better.run.grade === 'S');
check('runs are counted and kept, newest first', lib.find('Everlong', 'Foo Fighters').plays === 3
  && lib.find('Everlong', 'Foo Fighters').runs.map((r) => r.score).join() === '9000,4000,5000');
check('a played song is in the recent list', lib.recent()[0].title === 'Everlong');

lib.partDone(everlong, 'aaa', 'Chorus 1', { accuracy: 0.9, rate: 0.7 });
const e = lib.find('Everlong', 'Foo Fighters');
check('a part done slowly is kept but not learned', lib.part(e, 'aaa', 'Chorus 1').rate === 0.7 && !lib.learned(lib.part(e, 'aaa', 'Chorus 1')));
lib.partDone(everlong, 'aaa', 'Chorus 1', { accuracy: 0.6, rate: 0.6 });
check('a slower, worse try does not undo it', lib.part(e, 'aaa', 'Chorus 1').rate === 0.7 && lib.part(e, 'aaa', 'Chorus 1').tries === 2, lib.part(e, 'aaa', 'Chorus 1'));
lib.partDone(everlong, 'aaa', 'Chorus 1', { accuracy: 0.9, rate: 1 });
check('clean at full tempo is learned', lib.learned(lib.part(lib.find('Everlong', 'Foo Fighters'), 'aaa', 'Chorus 1')));

lib.reload();
check('it all survives a reload', lib.liked().length === 1 && lib.find('Everlong', 'Foo Fighters').best.score === 9000);
check('grades', ['S', 'A', 'B', 'C', 'D'].join() === [0.97, 0.9, 0.8, 0.7, 0.3].map(lib.grade).join());

console.log(failed ? `${failed} FAILED` : 'the library is right');
process.exitCode = failed ? 1 : 0;
