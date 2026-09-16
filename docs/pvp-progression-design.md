<!--
SPDX-FileCopyrightText: 2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PvP 진행도/컬렉션 설계 문서 (초안)

> **상태: 설계 단계. 코드 변경 없음.**
> 이 문서는 [`pvp-online-battle-design.md`](./pvp-online-battle-design.md)(배틀 실행 레이어: 통신 프로토콜, 결정론적 락스텝, 서버 중재)를 전제로, 그 위에 얹히는 **"PvE에서 무엇을 얻고, PvP에서 그것을 어떻게 쓰는가"** — 즉 Global Pokémon Collection, 아이템 언락, PvE→PvP 정규화, 기믹 락 시스템을 다룬다. 사용자가 제시한 설계안을 출발점으로 삼되, `pokerogue` 클라이언트(`claude/nice-fermi-xjbj85`)의 실제 세이브 데이터 구조를 직접 읽고 각 항목의 실현 가능성을 검증했다.
>
> **범위 제한**: 이 문서는 `pokerogue`(클라이언트)와 `rogueserver`(계정/세이브 서버)만 다룬다. 실시간 배틀 서버(`pvp-server/`)의 코드는 이 세션에서 수정하지 않는다는 기존 제약이 그대로 적용되며, 6장에서 `pvp-server/`에 필요한 **요구사항**만 인터페이스 수준으로 명시한다.

---

## 0. 핵심 결론 요약 (TL;DR)

1. **"Global Pokémon Collection"은 기존 저장 구조에 없는, 완전히 새로운 영속 데이터 계층이다.** 현재 개별 포켓몬 개체(`PlayerPokemon`, 구체적인 IV/성격/특성/현재 레벨을 가진 실체)는 `SessionSaveData.party: PokemonData[]`(`src/@types/save-data.ts:49`)에만 존재하고, 이는 **세이브 슬롯 1개(런 1개)에 종속**된다. 런이 끝나면(승리/패배/포기) 개별 개체는 사라지고, 계정 전역(`SystemSaveData`)에는 `dexData`(도감 목격/포획 **여부**와 종별 최고 IV만 — 개체 단위 아님), `starterData`(종별 사탕/특성 언락 — 역시 개체 단위 아님) 같은 **집계 정보만** 남는다(`src/@types/save-data.ts:25-42`). 즉 사용자가 제시한 `Charizard #A7F291, Origin: Run #1842`처럼 "그 포켓몬 개체"를 계정에 영구 보관하는 기능은 **새 기능 추가가 아니라 새 서브시스템 신설**이다. 이 문서 2장에서 이를 기존 직렬화 포맷(`PokemonData`)을 재사용해 최소 침습적으로 설계한다.
2. 반대로 **"PvE 런 전용 버프를 PvP에 가져가지 않는다"는 요구사항은 사실 이미 거저 만족된다.** Endless의 스탯 배율 버프 등은 `Modifier`(예: 각종 `PokemonHeldItemModifier`/필드 버프)로 구현되고, `SessionSaveData.modifiers`(`:51`)는 **런에 종속**되어 있어 애초에 계정 전역으로 넘어오지 않는다. Global Collection에 포켓몬을 "입고"할 때 그 포켓몬이 들고 있던 held item modifier만 별도로 다뤄주면(3장), 별도의 "PvE 전용 효과 필터링" 로직을 새로 짤 필요가 거의 없다.
3. **아이템 언락 시스템은 기존 `Unlocks`/`starterData` 패턴과 구조적으로 동일하다.** `Unlocks`(`:78-80`)는 이미 `{[key: number]: boolean}` 형태로 "계정이 무엇을 해금했는가"를 저장하는 선례이고, `starterData`의 `abilityAttr`/`passiveAttr`도 종별 언락 비트마스크다(`src/@types/save-data.ts:100`대 부근, `AbilityAttr`). 사용자가 제안한 "PvP 아이템 언락 여부만 저장, 수량 무제한"은 이 기존 패턴을 그대로 복제하면 된다 — 설계 난이도가 낮다.
4. **메가진화/테라스탈/기가맥스는 이미 데이터로 존재한다** (`src/enums/species-form-key.ts`, `generation-06~09.ts`의 폼 데이터). 다만 이 기능들이 현재 PvE 배틀에서 **얼마나 활성화되어 있는지**(예: 테라스탈이 실제로 배틀 UI에서 동작하는지)는 이번 조사에서 전부 확인하지 못했다 — 5장의 락 프레임워크는 "이미 도입됐다면 잠그는" 구조이지, 새로 이 기믹들을 구현하는 것이 아님을 전제로 한다. 실제 구현 전 재확인 필요.
5. **레벨/능력치 정규화(PvE Lv.12438 → PvP Lv.50)는 배틀 엔진이 아니라 "PvP 전용 스탯 재계산 레이어"로 넣는 것이 기존 구조와 가장 잘 맞는다.** 기존 스탯 계산(`Pokemon.calculateStats()` 계열, `getEffectiveStat()` — 세션 앞부분에서 캐싱 최적화를 적용한 그 함수)은 저장된 `level`을 그대로 읽어 계산한다. PvP에서는 배틀 시작 시점에 "이 개체의 실제 레벨/IV/성격/특성은 유지하되, 배틀 연산에 쓰이는 `level`만 PvP 규정값(예: 50)으로 오버라이드한 임시 `PlayerPokemon` 인스턴스를 구성"하는 방식이 안전하다. 원본 Global Collection 데이터는 건드리지 않는다.

---

## 1. 현재 데이터 모델 재정리

| 계층 | 파일/타입 | 무엇을 저장하는가 | 수명 |
|---|---|---|---|
| 런(세션) | `SessionSaveData`(`save-data.ts:44`) | `party: PokemonData[]` — 그 런의 실제 개체(IV/성격/특성/현재레벨/기술/개체별 modifier) | 런 종료 시 소멸(단, 세이브 슬롯에 남아있는 동안은 이어하기로 복귀 가능) |
| 계정(시스템) | `SystemSaveData`(`:25`) | `dexData`(종별 목격/포획 bool + 최고 IV), `starterData`(종별 사탕/특성/패시브/`valueReduction` — 개체 아님), `unlocks`, `voucherUnlocks`, `eggs` | 계정 존속 기간 내내 |
| 서버 | `rogueserver`의 `savedata` 테이블(session/system 각각 gob+zstd blob) | 위 두 구조를 그대로 직렬화 저장 | 동일 |

**포획한 개체 하나하나를 계정 단위로 영구 보관하는 제3의 계층은 현재 없다.** 이것이 이번 설계의 핵심 신설 대상이다.

`PokemonData`(`src/system/pokemon-data.ts`)는 이미 "개체 하나를 완전히 직렬화"하는 포맷으로, `id`, `species`, `formIndex`, `abilityIndex`, `passive`, `nature`, `moveset`, `ivs`, `hp`, `level`, `shiny`, `variant`, `luck`, `fusionSpecies` 등 사용자가 요구한 "그 개체의 정체성"을 이미 전부 담고 있다. → **새 직렬화 포맷을 설계할 필요 없이, 이 타입을 재사용**하면 된다.

---

## 2. Global Pokémon Collection 설계

### 2.1 데이터 구조 (클라이언트/서버 공통)

```ts
/** 계정에 영구 등록된 포켓몬 개체 하나. */
interface BankedPokemon {
  /** 전역 고유 ID. 사용자 제안의 "Pokemon UID"에 해당 — 서버가 발급(uuid). */
  uid: string;
  /** 개체 데이터 자체. 기존 PokemonData를 그대로 재사용. */
  data: PokemonData;
  /** 이 개체가 어느 런에서 왔는지 — 표시용, 배틀 로직에는 영향 없음. */
  originRunSeed: string;
  originTimestamp: number;
  /** PvE 세션 내 실제 레벨(사용자 제안의 "PvE Level"). PvP 배틀에서는 쓰이지 않고 프로필 표시에만 쓰인다. */
  pveLevel: number;
  /** 이 개체가 들고 있던 held item modifier 중, PvP 반입이 허용된 것만 남긴 목록(3장). */
  bankedHeldItems: PvpItemId[];
}
```

서버(`rogueserver`) 쪽에는 `accounts`에 딸린 새 테이블(예: `banked_pokemon`, PK `uid`, FK `username`)이 필요하다 — 기존 `cheatsEnabled` 컬럼을 추가했던 방식과 동일한 마이그레이션 패턴(`db/db_setup.go`의 `addColumnIfNotExists`류)으로 확장 가능.

### 2.2 "입고(banking)" 시점 — 언제 개체가 Global Collection에 들어가는가

이 부분은 **밸런스에 직결되는 정책 결정**이라 이 문서가 단정하지 않고 세 가지 옵션만 제시한다:

- **A. 포획 즉시 입고**: 잡는 순간 바로 계정에 귀속. 구현은 쉽지만 "런 도중 죽으면 사라지는" 로그라이크 긴장감이 사라짐.
- **B. 런 종료(클리어/승리) 시 그 런에서 살아남은 파티만 입고**: 로그라이크 정체성 유지, 기존 "클리어 시 보상 지급" 흐름(예: 사탕 지급 로직)과 같은 훅 지점에 얹을 수 있음.
- **C. 런 종료 시 파티 전원 입고(생사 무관)**: B보다 관대함.

**권장**: B. 기존에 런 클리어 시 실행되는 보상/집계 로직(정확한 훅 지점은 구현 단계에서 재확인 필요, `game-data.ts`의 `saveAll`/클리어 판정 부근으로 추정)에 "파티 스냅샷을 Global Collection에 POST"하는 단계를 추가하는 형태가 기존 흐름과 가장 자연스럽게 맞물린다.

### 2.3 왜 이게 "쉬운 확장"이 아니라 "신규 서브시스템"인가

- 클라이언트: 새 UI(컬렉션 뷰, PvP 팀빌더)가 필요하다 — 기존 파티 관리 UI(`starter-select-ui-utils.ts` 등)와는 다른 화면.
- 서버: 새 DB 테이블 + 새 REST 엔드포인트(`GET/POST /pvp/collection` 류)가 필요하다.
- 저장 용량: `PokemonData` 하나가 결코 작지 않은데(모든 필드 포함), 헤비 유저가 수백 마리를 입고하면 계정 저장 크기가 세션 세이브보다 커질 수 있다 — 서버의 `MaxBytesReader`(이번 세션에서 8MiB로 설정한 그 제한)와 별도로 컬렉션 전용 한도/페이지네이션을 고려해야 한다.

이 셋 중 어느 것도 "작은 변경"이 아니므로, 전체 로드맵에서 **가장 먼저, 별도 단계로** 잡아야 한다는 사용자의 원래 순서(1️⃣ Global Collection)가 정확히 맞다.

### 2.4 대안(사용자 제안): 새 서브시스템 없이 "현재 세이브 슬롯의 파티"만 재사용

사용자가 제안한 단순화안 — *"파티 6마리 선택창은 PvE 클래식 포켓몬 처음 선택창을 응용하고, 거기 뜨는 포켓몬은 세이브에 저장된 파티 포켓몬만 넣으면 되지 않냐"* — 를 코드로 검증했다. 결론부터: **데이터 계층만 보면 이미 거의 다 만들어져 있다.**

기존 "이어하기(Continue)" 화면(`save-slot-select-ui-handler.ts`)이 정확히 이 작업을 이미 하고 있다:

- `populateSessionSlots()`(`:323`)가 슬롯 5개(`SESSION_SLOTS_COUNT`) 각각에 대해 `SessionSlot`을 만들고 `load()`를 호출한다.
- `SessionSlot.load()`(`:625`)는 `globalScene.gameData.getSession(this.slotId)`를 호출하는데, 이 `getSession()`(`game-data.ts:802`)은 로컬스토리지 캐시 또는 서버(`pokerogueApi.savedata.session.get`)에서 **그 슬롯의 완전한 `SessionSaveData`**(즉 `party: PokemonData[]` 전체 — 종/레벨/개체값/성격/특성/기술/보유 아이템까지 포함하는 완전한 개체 데이터)를 그대로 가져온다.
- `SessionSlot.setupWithData()`(`:552`)는 이미 이 `data.party`를 순회하며 각 개체를 `p.toPokemon()`으로 되살려 아이콘+레벨을 그려 보여준다(`:579-600`) — "세이브에 저장된 파티 포켓몬을 목록으로 보여주는" 로직이 **글자 그대로 이미 존재**한다.

즉 새 DB 테이블도, 새 서버 API도 없이, **슬롯 0~4에 대해 `getSession(slotId)`를 호출해 `.party`를 모으기만 하면** 최대 5슬롯 × 6마리 = 최대 30마리의 실제 개체 데이터를 PvP 팀빌더 후보로 쓸 수 있다. 서버(`rogueserver`, `pvp-server`) 어느 쪽도 건드릴 필요가 없는, 순수 클라이언트 단독 구현이다.

**다만 2장의 Global Collection과는 본질적으로 다른 것**이라는 점은 분명히 해야 한다:

| | 2장: Global Collection | 2.4절: 세이브 슬롯 재사용 |
|---|---|---|
| 저장 위치 | 계정 전역 신규 테이블 | 기존 `SessionSaveData`(런 종속) |
| 영속성 | 런이 끝나도 영구 보존 | **런이 끝나고 그 슬롯에 새 런을 시작하는 순간 덮어써져 사라짐** — "컬렉션"이 아니라 "지금 진행 중인 런들의 스냅샷" |
| 최대 보유 수 | 무제한(정책상 상한 논의 중, 8절) | 사실상 "동시에 진행 중인 런 개수 × 6" — 대부분의 플레이어는 슬롯 1~2개만 사용하므로 실제로는 6~12마리 수준일 가능성이 높음 |
| 서버 변경 | 필요(새 테이블+API) | **불필요** |
| UI 작업 | 신규 컬렉션 뷰 + 팀빌더 | 팀빌더만(단, 아래 주의점 있음) |

**UI 재사용 관련 주의점**: "클래식 포켓몬 처음 선택창"(`starter-select-ui-handler.ts`)은 도감/사탕 데이터를 기반으로 **종(species)을 고르고 그 자리에서 IV/특성/성격/폼을 커스터마이징**하는 화면이다. 반면 세이브 슬롯의 `PokemonData`는 이미 IV/성격/특성/기술이 확정된 "완성된 개체"다. 따라서 그 화면을 100% 그대로 쓰기보다는, 커스터마이징 패널은 빼고 "이미 확정된 개체 목록에서 6마리 고르기"에 가깝게(오히려 이 절에서 본 `SessionSlot`의 아이콘+레벨 나열 방식에 더 가깝게) 조정하는 편이 맞다 — 완전 재사용은 아니고 부분 재사용.

**권장**: 이 방식을 Global Collection(2장)을 **대체**하는 게 아니라, 로드맵 1단계를 **선행하는 0단계(빠른 MVP)**로 채택한다. 서버 작업 없이 클라이언트만으로 "일단 동작하는 PvP 팀 선택"을 빨리 검증해볼 수 있고, 이후 2장의 영구 Global Collection은 "여러 런에 걸쳐 모은 개체를 보관하고 싶다"는 수요가 실제로 확인되면 그때 얹는 v2 확장으로 미룰 수 있다. 로드맵(7장)과 미결 사항(8절)에도 이 선택지를 반영했다.

### 2.5 팀 구성 규칙: 종 중복 금지 (Species Clause)

사용자가 확정한 규칙: 후보 목록(2.1의 Global Collection이든, 2.4의 세이브 슬롯 풀이든)에서 같은 종의 서로 다른 개체가 여러 마리 있을 수 있다면(예: 세이브1의 리자몽 A, 세이브2의 리자몽 B — IV/성격/레벨이 서로 다른 별개 개체) **목록에는 전부 노출**한다. 다만 실제 **6마리 PvP 파티에는 같은 종을 중복해서 넣을 수 없다** — 후보로 뜬 여러 리자몽 중 정확히 한 마리만 최종 파티에 들어갈 수 있다.

이는 경쟁 포켓몬 룰셋에서 흔한 "종 중복 금지(Species Clause)"와 동일한 개념이며, 4장의 PvE→PvP 정규화와 같은 층위의 **팀 구성 시점 검증 규칙**이다.

**구현 지점**:
- 팀빌더 UI: 한 개체를 선택하면, 같은 `species`를 가진 다른 후보 개체는 그 선택이 해제될 때까지 비활성화(선택 불가 표시)해야 한다. 2.4절에서 재사용 대상으로 지목한 `SessionSlot` 나열 방식에는 이런 "선택 시 동종 상호 배제" 로직이 없으므로 팀빌더 UI에 신규로 추가해야 한다.
- 서버 검증: 클라이언트 UI에서만 막으면 변조된 클라이언트가 우회할 수 있으므로, `pvp-server`(6장 요구사항에 추가 — 이 세션에서 직접 수정하지 않음)가 팀 제출 메시지 처리 시점에 같은 species 중복 여부를 서버 측에서도 재검증해야 한다. 3.3절("팀 내 중복 아이템 금지 — 서버 검증 지점")과 동일한 패턴.
### 2.6 폼 변경체·리전폼·융합체의 "같은 종" 판정 (사용자 제안 검증 결과)

사용자가 제안한 "폼이 다르다고 팀 슬롯 우회를 허용하지 않는다"는 철학에는 전적으로 동의한다. 다만 실제 코드를 확인한 결과, 제안된 판정 기준 중 일부는 이 프로젝트의 실제 데이터 모델과 다르게 동작한다 — 아래는 코드로 검증한 최종 규칙이다.

**① 메가진화·폼체인지(Black/White Kyurem 포함) → 이미 같은 `species` 값이라 별도 처리가 필요 없다.**

이 프로젝트에서 메가진화와 폼체인지는 `SpeciesId`를 바꾸지 않고 `formIndex`만 바꾼다. 예를 들어 Mega Charizard X/Y는 둘 다 `SpeciesId.CHARIZARD` (`src/enums/species-id.ts:13`, 단일 항목)이고 `formIndex`만 1/2로 다르다(`off-stat-denylist.ts:270-271`이 이걸 `formIndex` 키로 구분하는 게 그 증거). **사용자가 예로 든 Black/White Kyurem도 정확히 이 패턴이다** — `SpeciesId.KYUREM` 하나에 `formIndex` 0/1/2(Normal/Black/White)로 구현되어 있고(`generation-05.ts:14460-14574`), 폼 전환은 `SpeciesFormChangeItemTrigger`(DNA Splicers 아이템)로 일어난다. 즉 **`species` 필드만 비교하고 `formIndex`는 아예 무시하면 이 케이스 전부가 공짜로 해결된다** — 사용자가 제안한 "canonical group 리졸버" 없이 기존 필드 비교만으로 충분하다.

**② 리전폼(알로라/가라르 등) → 사용자 제안과 달리, 이 프로젝트에서는 완전히 별개의 `SpeciesId`다.**

`SpeciesId.MEOWTH`(:105)와 `SpeciesId.ALOLA_MEOWTH = 2052`(:2071), `SpeciesId.GALAR_MEOWTH = 4052`(:2093)는 서로 다른 정수 ID이고, 각각 자기 진화 라인·`starterCost`·도감 슬롯을 독립적으로 가진다(예: `generation-07.ts:11234` — 알로라 나옹은 `starter: SpeciesId.ALOLA_MEOWTH`로 별도 스타터, 진화 대상도 `ALOLA_PERSIAN`으로 기본 나옹의 `PERSIAN`과 다름). **①과 달리, "리전폼을 기본종과 같은 그룹으로 묶기"는 필드 하나 무시하면 끝나는 문제가 아니라, 지금 코드베이스에 없는 신규 매핑 테이블(예: 나옹↔알로라 나옹↔가라르 나옹)을 새로 만들어 유지보수해야 하는 작업이다.** 이건 실제 신규 데이터 큐레이션 비용이 드는 결정이므로 8절 미결 사항으로 남긴다 — MVP 단계에서는 리전폼을 별개 종으로 취급(=묶지 않음)하는 쪽을 기본값으로 권장한다. 이 프로젝트의 다른 모든 시스템(도감, 스타터 코스트, 진화)이 이미 리전폼을 별개 종으로 취급하고 있어서, 그 기존 관례와 맞기 때문이다.

**③ 융합(Splice/DNA Splicers) → 사용자가 우려한 "재료+결과물 동시 보유" 악용은, 실제 융합 메커니즘 자체가 구조적으로 막고 있다.**

`Pokemon.fuse(pokemon2)`(`src/field/pokemon.ts:6375-6436`)를 코드로 추적하면: 융합이 일어나는 순간 `globalScene.getPlayerParty().splice(fusedPartyMemberIndex, 1)`로 **재료로 쓰인 두 번째 개체를 파티에서 즉시 제거하고 `pokemon.destroy()`까지 호출한다.** 즉 한 런 안에서는 "리자몽 + 이상해꽃 + 리자몽/이상해꽃 융합체"가 동시에 파티에 존재하는 상황 자체가 게임 엔진 차원에서 불가능하다 — 재료는 융합과 동시에 사라진다. (참고로 사용자가 예로 든 "큐레무 + 레시라무 → 화이트 큐레무"는 이 융합 메커니즘이 아니라 위 ①의 폼체인지다 — 레시라무는 소모되지 않고 파티에 남는 게 맞다. 레시라무는 큐레무와 다른 종이므로 함께 있어도 문제 없다.)

**남는 허점은 딱 하나**: 2.4절 MVP처럼 세이브 슬롯 5개를 풀로 합치는 구조에서는, 세이브1의 "리자몽+이상해꽃 융합체"와 세이브2의 (한 번도 융합 안 된) 순수 "이상해꽃" 개체가 **서로 다른 런에서 온 별개의 살아있는 개체**이므로 동시에 후보 목록에 뜰 수 있다. 이 경우엔 사용자가 제안한 "융합 구성종 중 하나라도 팀에 있으면 중복 판정"이 정확히 맞는 해법이다.

**최종 리졸버** (사용자 제안의 "canonical species group" 대신, 실측 결과 훨씬 단순해졌다):

```ts
/** PvP 종 중복 판정에 쓰이는, 한 개체가 "차지하는" 종 슬롯들. */
function getPvpSpeciesSlots(data: PokemonData): SpeciesId[] {
  // formIndex는 보지 않는다 - 메가/폼체인지(Black/White Kyurem 등)는 이미 같은 species 값이라
  // 별도 처리가 필요 없다(2.6절 ①). 융합체는 species와 fusionSpecies 둘 다 "차지한다"(2.6절 ③).
  return data.fusionSpecies ? [data.species, data.fusionSpecies] : [data.species];
}

/** 이미 선택된 팀원들과 종이 겹치는지 검사. 리전폼은 별개 종이므로(2.6절 ②) 그대로 SpeciesId 값 비교로 충분. */
function conflictsWithTeam(candidate: PokemonData, team: PokemonData[]): boolean {
  const candidateSlots = getPvpSpeciesSlots(candidate);
  return team.some(member => getPvpSpeciesSlots(member).some(id => candidateSlots.includes(id)));
}
```

---

## 3. 아이템 언락 시스템

### 3.1 기존 패턴 재사용

```ts
/** SystemSaveData에 추가될 필드. 기존 Unlocks(:78)와 완전히 같은 모양. */
interface PvpItemUnlocks {
  [itemId: string]: boolean; // 또는 PvpItemId를 key로 하는 Record
}
```

`Unlocks`가 이미 이 정확한 모양으로 `SystemSaveData`에 들어있으므로, 마이그레이션(`AppliedMigrators`, `save-migrators.ts`)까지 기존 관례를 그대로 따라 추가하면 된다.

### 3.2 "배틀 아이템 vs PvE 전용 아이템" 분류

기존 아이템 정의(`modifierTypes` 레지스트리, `src/modifier/modifier-type.ts` — 이번 세션 초반 치트 계정 아이템 지급 기능에서 다뤘던 바로 그 구조)에 **이미 카테고리 구분이 어느 정도 존재한다**(예: `PokemonHeldItemModifierType`처럼 특정 포켓몬에 귀속되는 타입 vs 계정 전역 `ModifierType`). PvE 전용 로그라이크 효과(예: Endless 전용 누적 버프)는 대개 `ModifierType`이 아니라 `Battle`/`Arena` 상태나 챌린지 로직에 직접 박혀있을 가능성이 높다 — 즉 **"held item으로 표현되는 것"과 "런 상태로 표현되는 것"의 경계가 이미 어느 정도 카테고리 분리 역할을 한다.** 정확한 allow-list는 실제 `modifierTypes` 레지스트리를 전수 조사해서 PvP 반입 가능 여부를 태깅하는 작업이 필요하다(구현 단계 작업, 설계로 대체 불가).

### 3.3 팀 내 중복 아이템 금지 — 서버 검증 지점

이건 6장(`pvp-server/` 요구사항)에서 다룬다: 클라이언트가 `SUBMIT_TEAM`으로 보내는 `PvpPartyMemberDto[]`(`pvp-server/src/protocol.ts`)에 held item 필드가 추가된다면, `pvp-server`가 그 배열을 받는 시점에 (a) 계정이 그 아이템을 언락했는지, (b) 같은 아이템이 팀 내에서 중복되지 않는지를 검증해야 한다.

---

## 4. PvE → PvP 정규화

### 4.1 레벨 정규화

```ts
/** 배틀 시작 시, BankedPokemon → PvP 전투용 PlayerPokemon 변환. */
function toPvpBattleInstance(banked: BankedPokemon, ruleset: PvpRuleset): PlayerPokemon {
  const pokemon = /* 기존 PokemonData → PlayerPokemon 복원 로직 재사용 */;
  pokemon.level = ruleset.battleLevel; // 예: 50. 원본 banked.data.level은 그대로 보존.
  pokemon.calculateStats(); // 기존 스탯 재계산 함수를 이 조정된 level로 재실행
  return pokemon;
}
```

핵심은 **원본 `BankedPokemon.data`를 절대 변형하지 않고, 배틀에 들어갈 때만 복사본을 만들어 레벨을 덮어쓰는 것**이다. 이러면 "PvE Level 기록은 유지, PvP 능력치만 정규화"라는 요구사항이 자연스럽게 만족된다.

### 4.2 스탯 재계산이 실제로 안전한가

이번 세션 초반에 `getEffectiveStat()`(`src/field/pokemon.ts:1461-1578`)에 캐싱을 추가했는데, 그 캐시는 **어빌리티/무브 속성 조회**에 대한 것이지 레벨 기반 베이스 스탯 계산과는 무관하므로 이 설계와 충돌하지 않는다. 다만 PvP용 임시 인스턴스를 만들 때 `Ability`/`Move` 객체 자체는 공유(싱글턴)해도 무방하지만, `PlayerPokemon` 인스턴스는 반드시 별도로 생성해야 원본 세이브가 오염되지 않는다.

---

## 5. 기믹(메가/Z-Move/기가맥스/테라스탈) 락 프레임워크

```ts
interface PvpRuleset {
  battleLevel: number;           // 예: 50
  allowMega: boolean;
  allowZMove: boolean;
  allowGigantamax: boolean;
  allowTerastal: boolean;
}
```

서버가 이 `PvpRuleset`을 배틀 시작 시 양 클라이언트에 내려주고(기존 `BATTLE_START` 메시지, `pvp-server/src/app.ts:240`에 필드 추가), 클라이언트는 팀빌더 UI에서 잠긴 기믹 관련 아이템/폼을 선택 불가로 표시한다. **서버도 동일 ruleset으로 `SUBMIT_TEAM`을 검증**해야 클라이언트 조작으로 잠긴 기믹을 우회하는 것을 막을 수 있다(6장).

이 구조는 "처음엔 다 false, 나중에 조건부로 true"라는 사용자의 요구사항을 설정 값 하나 바꾸는 것으로 만족시키므로 추가 설계가 필요 없다 — **단, 어떤 조건으로 언제 true가 되는지(랭크? 승수? 기간?)는 별도 정책 결정 사항**이며 이 문서의 범위 밖이다.

---

## 6. `pvp-server`에 필요한 요구사항 (설계만, 구현은 이 세션에서 하지 않음)

> 이 세션은 `pvp-server/`의 코드를 수정하지 않는다는 기존 제약을 유지한다. 아래는 그 저장소를 다룰 별도 작업(혹은 별도 승인)을 위한 **인터페이스 수준 요구사항**이다.

1. `SUBMIT_TEAM` 처리 시, 각 `PvpPartyMemberDto`의 `heldItem`이 (a) 해당 계정의 `PvpItemUnlocks`에 있는지, (b) 팀 내 중복이 없는지, (c) `PvpRuleset`상 잠긴 기믹 관련 아이템이 아닌지를 검증 — 현재 `room.ts`의 `setTeam()`(`:125`)은 이런 검증 없이 그대로 받아들인다.
2. 이 검증을 하려면 `pvp-server`가 계정의 언락 상태를 알아야 하므로, `rogueserver`에 **계정 세션 토큰으로 PvP 언락 정보를 조회하는 내부 API**가 필요하다(`pvp-server`가 `rogueserver`를 호출하는 새 경로 — 현재 두 서버는 서로 통신하지 않는다).
3. `BATTLE_START` 메시지에 `PvpRuleset`을 실어 보내도록 `protocol.ts`의 `ServerMessage` 타입 확장이 필요하다.

이 세 가지는 모두 **`pvp-server`의 기존 아키텍처(방-기반, 커밋-리빌, 서버가 최종 검증)를 그대로 따르는 확장**이지, 재설계가 아니다 — 기존 설계 문서 7장(`pvp-online-battle-design.md`)의 "서버가 authoritative하다"는 원칙과 정확히 일치한다.

---

## 7. 개정된 단계별 로드맵

사용자가 제시한 순서를 그대로 채택하되, 각 단계가 실제로 건드리는 저장소/레이어를 명시한다:

| 단계 | 내용 | 주요 작업 위치 |
|---|---|---|
| 0️⃣ (선택) | 세이브 슬롯 파티 재사용 MVP (2.4절) | `pokerogue`만(서버 변경 없음) — 5개 슬롯의 `getSession().party`를 모아 팀빌더 후보로 사용 |
| 1️⃣ | Global Pokémon Collection | `rogueserver`(새 테이블/API) + `pokerogue`(입고 트리거, 컬렉션 조회 UI) |
| 2️⃣ | PvP Team Builder | `pokerogue`(신규 UI, 0단계를 했다면 그 UI를 확장) |
| 3️⃣ | PvP Ruleset / 정규화 | `pokerogue`(4장의 변환 로직) + `pvp-server`(ruleset 배포/검증, 별도 승인 필요) |
| 4️⃣ | 온라인 1v1 Single | 이미 대부분 존재 (`pvp-server/`, `pvp-online-battle-design.md` 참고) |
| 5️⃣ | 온라인 1v1 Double | `pvp-server`(기존 `Battle.double`/`BattlerIndex` 확장, 설계 문서 §11 기준) |
| 6️⃣ | Room / 친구 초대 | 대부분 이미 존재(`room-manager.ts`의 room code 방식) |
| 7️⃣ | Random Matchmaking | 신규 — `pvp-server`에 매칭 큐 필요 |
| 8️⃣ | Replay / Spectator | 신규 — 턴 커맨드 로그를 저장/재생하는 기능, `SUBMIT_COMMAND` 로그를 누적 저장하면 기반은 이미 있음 |
| 9️⃣ | Ranked / 시즌 | 신규 — 별도 레이팅 데이터 계층 |

**1~3단계가 이 문서의 범위**이고, 이 문서가 다루지 않는 4단계 이후는 기존 `pvp-online-battle-design.md`가 이미 상당 부분 설계해두었다.

---

## 8. 이 설계에서 아직 결정되지 않은 것 (의도적으로 열어둠)

- 0단계(2.4절, 세이브 슬롯 재사용 MVP)를 실제로 먼저 만들지, 아니면 처음부터 1단계(Global Collection)로 바로 갈지
- 2.2절의 입고 시점(A/B/C)
- 3.2절의 정확한 PvP 허용 아이템 allow-list(전체 `modifierTypes` 전수 조사 필요)
- 5장 기믹의 구체적 해금 조건
- Global Collection의 용량 상한(무제한? 계정당 N마리?)
- ~~같은 종을 여러 마리 입고했을 때 UI에서 어떻게 구분해 보여줄지~~ → 2.5절에서 해소: 목록엔 전부 노출, 팀 구성 시 종 단위로 1마리만 선택 가능(Species Clause)
- ~~메가/폼체인지, 융합체를 "같은 종"으로 취급할지~~ → 2.6절에서 코드 검증 완료: 메가·폼체인지는 `species` 필드가 이미 동일해 추가 작업 없이 해소, 융합체는 `species`+`fusionSpecies` 둘 다 검사하는 것으로 해소
- **아직 열림**: 리전폼(알로라/가라르/히스이/팔데아)을 기본종과 같은 그룹으로 묶을지 — 묶으려면 이 코드베이스에 없는 신규 매핑 테이블이 필요(2.6절 ②). MVP 기본값은 "묶지 않음(별개 종 취급)"을 권장하되, 최종 결정 필요.

이 항목들은 밸런스/UX 정책 결정이라 코드 조사만으로는 답이 나오지 않는다 — 구현에 들어가기 전에 확정이 필요하다.
