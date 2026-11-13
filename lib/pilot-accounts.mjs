// Shared by the admin API (TypeScript) and scripts/setup-pilot.mjs (plain Node).
// Server only: it uses node:crypto. Browser/middleware code imports account-codes.mjs.
import { randomInt } from "node:crypto";

export { codeToHiddenEmail, RESIDENT_EMAIL_DOMAIN, validateAccountCode } from "./account-codes.mjs";

/** Short common English words for readable passwords. */
export const PASSWORD_WORDS = Object.freeze(`
  able acid acorn actor add aged agent air alarm album alley amber angle ankle apple april apron arch
  area arena arm army arrow art ash aunt autumn avenue award axe baby back bacon badge bag bake baker
  ball bamboo banana band bank barn base basin basket bath beach bead beam bean bear beard bed bee
  beef bell belt bench berry bike bird birch biscuit black blade blanket blaze blend block bloom blue
  board boat body bolt bone bonus book boot border bottle bow bowl box brain branch brass bread brick
  bridge brief bright broom brush bucket buddy build bulb bunch bus bush butter button cabin cable
  cactus cake calm camel camera camp candle candy canoe canvas cape card cargo carpet carrot cart
  case castle cat cave cedar cell cereal chain chair chalk charm chart cheese cherry chess chest
  chief chin chip choir cider circle city clay clerk cliff climb clock cloud clover club coach coal
  coast coat cocoa code coffee coin cold comet cook cool copper coral cord corn cotton couch count
  cousin cover cow crab craft crane cream creek crisp crow crown cube cup curve cycle daisy dance
  dawn day deck deer delta denim desk dial diary dinner disk dock dog doll dolphin door dot dough
  dove dragon drawer dream dress drift drink drum duck dune dust eagle earth easel echo edge egg
  elbow elk ember empty engine entry equal error event exit fabric face fair fairy falcon farm feast
  feather fence fern ferry field fig film finch fire fish flag flame flash fleet flint float flock
  floor flour flower flute foam fog folk food foot forest fork fort fossil fox frame fresh frog frost
  fruit fudge gadget game garden gate gecko gem giant gift ginger glass globe glove glow goat gold
  golf goose grain grape grass gravel green grid grill guest guide gull habit hall hammer hand harbor
  harp hat hawk hazel heart hedge helmet herb heron hill hobby honey hood hook horn horse hotel hour
  house igloo ink inlet iris iron island ivory ivy jacket jade jam jar jazz jelly jewel job jolly
  judge juice jump jungle kayak kettle key kid kind king kite kitten kiwi knee knot koala ladder lady
  lake lamb lamp lane laser latch lawn layer leaf ledge lemon lens level lid light lilac lily lime
  linen lion list llama lobby lock lodge logic loop lotus lucky lunch magic magnet mango maple marble
  market mask meadow medal melon menu metal meter mild milk mill mint mirror mist mitten model moon
  moose moss motor mouse mud mug music nail name napkin navy nest net noble noodle north note novel
  nut oak oasis oat ocean olive onion opal orange orbit orchid otter oven owl ox pad paddle page
  paint palm panda paper parade park parrot pasta path peach peak pear pearl pebble pecan pen pencil
  pepper piano picnic pie pier pig pilot pine pink pipe pizza plain planet plant plate plum pocket
  poem polar pond pony pool poppy port pot potato pouch prism prize puppy purple quail quartz queen
  quest quiet quilt rabbit radar radio raft rain ranch raven ray reef relay rice ridge ring river
  road robin robot rock rocket roof room root rope rose round royal ruby rug ruler saddle safe sail
  salad salt sand satin sauce scale scarf school scout sea seal season seed shade shadow shark sheep
  shell shelf ship shoe shore silk silver sister sky sled sleep slope smile snack snail snow soap
  sock sofa soil solar song soup south spark spice spider spoon spring square squid stable stage
  stamp star steam stem step stick stone stool storm story stove straw stream street sugar suit
  summer sun swan sweet swing table tail tank tea teapot tent theme thread thumb ticket tiger timber
  toast token tomato tool topaz torch tower town toy track trail train tree trout truck tulip tuna
  tunnel turtle twig umber uncle unit valley vapor vase velvet violet violin visit voice wagon walnut
  walrus wand water wave wax whale wheat wheel whistle willow wind window wing winter wolf wood wool
  world yacht yard year yellow yogurt zebra zero zinc zone
`.trim().split(/\s+/));

/**
 * Four random words and two digits, hyphen-joined, e.g. "maple-otter-cloud-ring-07".
 * Uses crypto.randomInt, so every pick is from a secure source.
 */
export function generateReadablePassword() {
  const words = Array.from({ length: 4 }, () => PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)]);
  const digits = String(randomInt(100)).padStart(2, "0");
  return [...words, digits].join("-");
}
