<!--
SPDX-FileCopyrightText: 2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# 온라인 1v1 PvP 배틀 설계 문서 (초안)

> **상태: 설계 단계. 코드 변경 없음.**
> 이 문서는 저장소(`pokerogue` 클라이언트, 브랜치 `claude/nice-fermi-xjbj85`)의 실제 코드를 직접 읽고 분석한 결과를 근거로 작성되었다. 모든 주장에는 실제 파일 경로/클래스/함수명을 병기했다. 추측이나 일반론적인 "포켓몬류 PvP 설계"가 아니라, **이 저장소가 실제로 어떻게 짜여 있는지**를 출발점으로 삼는다.

---

## 0. 핵심 결론 요약 (TL;DR)

1. 이 클라이언트는 **서버 코드를 포함하지 않는다.** `src/api/*`는 순수 REST(`fetch`) 클라이언트이고, 실시간 통신(WebSocket 등) 코드는 저장소 어디에도 없다. 서버는 `VITE_SERVER_URL` 환경변수로만 가리키는 별도 저장소다. → PvP를 만들려면 **별도 서버 저장소에 새 서비스**를, **이 클라이언트 저장소에는 새 네트워크 모듈**을 추가해야 한다.
2. 전투 로직(`Phase` 시스템, `Move`/`Ability` 적용, 데미지 계산)은 **`globalScene: BattleScene`이라는 전역 싱글턴**(`src/globals/global-scene.ts`)에 강하게 결합되어 있고, `BattleScene`은 `Phaser.Scene`을 상속하며 렌더링·사운드·UI 호출이 로직 코드 안에 섞여 있다(예: `FaintPhase`가 직접 `globalScene.tweens.add(...)`, `audioManager.playSound(...)`를 호출). **이 엔진을 Node.js 서버에서 그대로 헤드리스로 돌릴 수 없다.** 이는 "서버 authoritative"와 "기존 엔진 재사용"이라는 두 요구사항이 정면으로 충돌하는 지점이며, 본 문서의 5장에서 이를 절충하는 구체적인 아키텍처(결정론적 락스텝 + 서버 중재/검증)를 제안한다.
3. 코드베이스는 철저히 **"Player(사람) vs Enemy(AI)"** 이분법으로 짜여 있다(`Pokemon.isPlayer(): this is PlayerPokemon`가 유일한 서브클래스 분기이며, `PlayerPokemon`/`EnemyPokemon` 두 클래스만 존재). "사람 vs 사람"을 표현하는 3번째 클래스는 없다. → 상대 플레이어의 포켓몬은 클라이언트 로컬에서 **여전히 `EnemyPokemon`으로 표현**하되, 그 행동 결정 지점(`EnemyCommandPhase`)만 AI 대신 네트워크 입력으로 대체하는 방식이 기존 코드와 가장 잘 맞는다.
4. 싱글/더블 배틀은 이미 `Battle.double: boolean` 하나로 깔끔하게 추상화되어 있고 `BattlerIndex`(`PLAYER=0, PLAYER_2=1, ENEMY=2, ENEMY_2=3`)가 최대 4인용 슬롯을 이미 상정하고 있다. → PvP도 처음부터 이 구조를 그대로 따르면 더블 확장이 자연스럽다.
5. 전투 RNG는 이미 `Battle.battleSeed`(턴 단위로 독립적으로 파생)를 통해 결정론적이다(`src/battle.ts:493-511`). 다만 이 시드는 **클라이언트가 로컬에서 무작위로 생성**한다(`randomString(16, true)`, `src/battle.ts:81`). 데일리런의 `/daily/seed`(`src/api/daily-api.ts`)처럼 **서버가 시드를 발급**하는 선례가 이미 있으므로, 같은 패턴을 PvP 배틀 시드에도 적용하면 된다.

---

## 1. 현재 코드 아키텍처 요약

### 1.1 실행 구조 / 전역 상태

- 엔트리포인트: `src/main.ts` → `Phaser.Game`을 생성하고 `BattleScene`(`src/battle-scene.ts`, 3,633줄)을 유일한 씬으로 등록한다.
- `src/globals/global-scene.ts`:
  ```ts
  export let globalScene: BattleScene;
  export function initGlobalScene(scene: BattleScene): void { globalScene = scene; }
  ```
  게임 전체가 **모듈 스코프의 가변 싱글턴** `globalScene` 하나에 의존한다. `Phase`, `Pokemon`, `Move`, `Ability` 등 거의 모든 로직 파일이 `import { globalScene } from "#app/global-scene"`로 이 싱글턴을 직접 참조한다. 이는 "배틀 인스턴스를 여러 개 동시에 독립적으로 돌린다"는 개념을 전제하지 않은 설계라는 뜻이며, 서버 쪽에서 여러 PvP 매치를 동시에 시뮬레이션해야 한다면 큰 제약이 된다(5장에서 상술).

### 1.2 BattleScene의 역할 (`src/battle-scene.ts`)

- `Phaser.Scene`을 상속하는 최상위 컨테이너로, 다음을 모두 한 클래스가 소유한다:
  - 현재 배틀 상태: `public currentBattle: Battle`(`:230`)
  - 파티/필드 조회 API: `getPlayerField()`(`:731`), `getEnemyField()`(`:758`), `getField()`(`:776`), `getPlayerParty()`, `getEnemyParty()`(`:738`)
  - RNG 시드 계층: `seed`, `waveSeed`, `rngSeedOverride`(`:276`), `resetSeed()`(`:2010`), `executeWithSeedOffset()`(`:2017`), `randBattleSeedInt()`(`:1098`, `Battle.randSeedInt`로 위임)
  - 배틀 생성: `newBattle(fromSession?)`(`:1257`) — 웨이브/바이옴 기반으로 새 `Battle`과 `Arena`를 생성하는, **로그라이크 런 진행에 강하게 묶인** 메서드
  - `PhaseManager`, `Arena`, UI, 오디오, 필드 스프라이트 컨테이너까지 전부 이 클래스의 프로퍼티다.
- 즉 `BattleScene`은 "배틀 엔진"이자 동시에 "렌더러"이자 "게임 상태 저장소"다. 세 가지 책임이 분리되어 있지 않다.

### 1.3 Battle 클래스의 역할 (`src/battle.ts`)

한 판의 전투(하나의 웨이브)를 나타내는 상태 객체.

```ts
export class Battle {
  public waveIndex: number;
  public battleType: BattleType;        // WILD | TRAINER | CLEAR | MYSTERY_ENCOUNTER
  public double: boolean;                // 싱글/더블 단일 플래그
  public turn = 0;
  public preTurnCommands: TurnCommands;  // { [BattlerIndex]: TurnCommand | null }
  public turnCommands: TurnCommands;
  public playerParticipantIds: Set<number> = new Set();
  public enemyParty: EnemyPokemon[] = [];
  public battleSeed: string = randomString(16, true);   // 배틀 1회당 1번 생성 (클라이언트 로컬 난수!)
  private battleSeedState: string | null = null;
  ...
  incrementTurn(): void { /* turn++, turnCommands/preTurnCommands 초기화, battleSeedState=null */ }
  getBattlerCount(): number { return this.double ? 2 : 1; }
  randSeedInt(range: number, min = 0): number { /* 턴 단위로 독립된 결정론적 RNG, 8장 참조 */ }
}
```

- `TurnCommand`(`:41-48`): `{ command: Command; cursor?; move?: TurnMove; targets?: BattlerIndex[]; skip?; args? }`
- `TurnCommands`(`:55-57`): `{ [key: number]: TurnCommand | null }` — **`Map`이 아니라 plain object**이며 key는 `BattlerIndex`(0~3, 그리고 `ATTACKER=-1`도 포함해 초기화됨).
- `BattleType`(`src/enums/battle-type.ts`)에는 `PVP`가 없다. `WILD | TRAINER | CLEAR | MYSTERY_ENCOUNTER` 4종뿐이며, 각 값은 "포켓볼 사용 가능 여부"(`command-phase.ts:354-399`), "도주 가능 여부"(`command-phase.ts:579-597`), "BGM"(`battle.ts:246-485`) 등 PvE 전용 분기에 쓰인다.

### 1.4 Phase 시스템 / PhaseManager

- `Phase`(`src/phase.ts`)는 `start()`/`end()`만 가진 최소 추상 클래스. `end()`는 항상 `globalScene.phaseManager.shiftPhase()`를 호출한다.
- `PhaseManager`(`src/phase-manager.ts`)는 `PhaseTree`(`src/phase-tree.ts`)라는 **레벨 구조 큐**로 다음 phase를 관리한다. 상세 규칙은 저장소 자체 문서인 `docs/phases.md`에 정리되어 있다(요약: `pushPhase`=맨 아래 레벨 끝에 추가, `unshiftPhase`=현재 레벨 바로 위에 추가하여 "자식 먼저 모두 처리" 순서를 보장, 큐가 완전히 비면 `turnStart()`가 자동으로 새 `TurnInitPhase`를 큐잉).
- `PhaseManager.create<T>()`(`:491`)가 문자열 이름(`PhaseString`) → 생성자 매핑(`PHASES` 상수 객체, `:126-223`)으로 동적 생성하는 팩토리 패턴을 쓴다. **새 Phase를 추가하려면 이 `PHASES` 객체에도 등록해야 한다.**
- `DynamicQueueManager`(`src/dynamic-queue-manager.ts`, 별도 조사는 생략했으나 `MovePhase` 순서 재조정(`forceMoveNext`/`forceMoveLast`), 페인트/스위치로 인한 무브 취소·리다이렉트에 관여)도 `PhaseManager`가 소유한다.

### 1.5 게임/플레이어/포켓몬 상태가 저장되는 위치

| 범위 | 클래스/파일 | 리셋 시점 |
|---|---|---|
| 계정(로그인) | `src/account.ts` (`loggedInUser` 모듈 변수) | 로그인/로그아웃 |
| 세이브데이터(영구) | `src/system/game-data.ts`의 `GameData` (덱스, 보이스, 스타터 등) | 서버 저장 |
| 런(세션) | `SessionSaveData`(`src/@types/save-data.ts`), 파티/골드/웨이브 진행 | 런 종료 |
| 배틀 1회 | `Battle`(`src/battle.ts`) | 새 웨이브마다 |
| 필드(아레나) | `Arena`(`src/field/arena.ts`): `weather`, `terrain`, `tags: ArenaTag[]` | 새 웨이브마다 |
| 포켓몬 — 배틀 전체 | `PokemonBattleData`(`src/data/pokemon/pokemon-data.ts:282`): `hasEatenBerry`, `berriesEaten[]` | 배틀 시작 시 |
| 포켓몬 — 웨이브 전체 | `PokemonWaveData`(`:307`): `endured`, `abilityRevealed` 등 | 새 웨이브 |
| 포켓몬 — 필드 체류(스위치 단위) | `PokemonSummonData`(`:101`): `statStages[7]`, `moveQueue`, `tags: BattlerTag[]`, 폼/타입 오버라이드, `moveset`, `moveHistory` | 스위치 아웃 또는 새 배틀 |
| 포켓몬 — 턴 단위 | `PokemonTurnData`(`:326`): `hitCount`, `damageTaken`, `attacksReceived[]`, `acted`, `pendingStatus` 등 | 매 턴 + 스위치 시 |
| 포켓몬 — 영구 | `Pokemon.hp`, `Pokemon.status`(`src/field/pokemon.ts:220,230`), IV/레벨/경험치 등 | 포획/부화까지 유지 |

이 계층 구조(배틀 전체 → 웨이브 → 필드체류 → 턴)는 **7장의 State 동기화 설계에서 그대로 재사용**할 수 있는, 이미 잘 정리된 기준선이다.

### 1.6 게임 진행이 결정되는 방식

1. UI 입력(버튼) → `src/ui/handlers/*-ui-handler.ts` → **현재 실행 중인 `CommandPhase` 인스턴스**를 `globalScene.phaseManager.getCurrentPhase()`로 얻어 `.handleCommand(...)`를 직접 호출.
   - 실제 호출부: `fight-ui-handler.ts:156`, `ball-ui-handler.ts:82`, `command-ui-handler.ts:140`, `party-ui-handler.ts:841`.
   - **이 지점이 "플레이어 입력이 시뮬레이션에 진입하는 유일한 진입점"이다.** PvP에서 네트워크 명령을 주입할 지점도 바로 여기다(4장/6장 참조).
2. `CommandPhase.handleCommand()`가 `globalScene.currentBattle.turnCommands[fieldIndex]`에 `TurnCommand`를 기록하고 `this.end()` → 다음 phase로.
3. 모든 필드 슬롯(플레이어+적, 싱글이면 2개, 더블이면 4개)의 명령이 다 모이면 `TurnStartPhase`가 속도 순으로 `MovePhase`/`SwitchSummonPhase`/`AttemptCapturePhase`/`AttemptRunPhase`를 큐잉.
4. 각 phase가 끝날 때마다 `PhaseManager.shiftPhase()`가 다음 phase를 꺼내 실행. 모든 큐가 비면 자동으로 `TurnInitPhase`(다음 턴) 시작.

---

## 2. 현재 PvE 전투 흐름 (실제 Phase 연결)

```
TurnInitPhase (src/phases/turn-init-phase.ts)
  ├─ 강제 진화/챌린지 위반 체크 → 필요시 강제 스위치
  ├─ globalScene.getField() (길이 4: [P0,P1,E0,E1]) 순회
  │    ├─ active한 PlayerPokemon 슬롯마다 → pushNew("CommandPhase", fieldIndex)
  │    └─ active한 EnemyPokemon 슬롯마다  → pushNew("EnemyCommandPhase", fieldIndex - BattlerIndex.ENEMY)
  └─ pushNew("TurnStartPhase")

CommandPhase(fieldIndex)  [플레이어 슬롯 수만큼 반복]
  └─ UI가 FIGHT/BALL/POKEMON/RUN/TERA 결정 → handleCommand()
       └─ turnCommands[fieldIndex] = TurnCommand 기록
       └─ (무브가 다중 타겟 가능하면) unshiftNew("SelectTargetPhase", fieldIndex)

EnemyCommandPhase(fieldIndex)  [적 슬롯 수만큼 반복]
  └─ 트레이너면 매치업 스코어로 스위치 여부 결정(결정론적 임계값 비교, RNG 없음)
  └─ enemyPokemon.getNextMove() — AiType(SMART/SMART_RANDOM 등)에 따라 무브 선택,
     여기서 randBattleSeedInt() RNG 사용 (src/field/pokemon.ts:6752,6902-6918)
  └─ turnCommands[BattlerIndex.ENEMY + fieldIndex] = TurnCommand 기록

SelectTargetPhase(fieldIndex)   [다중 타겟 가능한 기술에서만]
  └─ UI로 타겟 선택 → turnCommand.targets 기록

TurnStartPhase
  ├─ getCommandOrder(): 커맨드 "종류" 우선순위 정렬 (SWITCH/BALL/RUN이 FIGHT보다 항상 먼저)
  ├─ TERA 커맨드 처리 (속도순)
  ├─ inSpeedOrder(BOTH) (src/utils/speed-order-generator.ts)로 스피드 순서 계산
  │    └─ PokemonPriorityQueue → sortInSpeedOrder() (그룹핑 → 턴+파티길이 시드 기반 동률 셔플 → 실효 스피드 내림차순, 트릭룸 반전)
  ├─ moveOrder 순회하며 handleTurnCommand():
  │    ├─ FIGHT   → pushNew("MovePhase", pokemon, targets, move, useMode)
  │    ├─ POKEMON → unshiftNew("SwitchSummonPhase", ...)
  │    ├─ BALL    → unshiftNew("AttemptCapturePhase", ...)
  │    └─ RUN     → unshiftNew("AttemptRunPhase")
  ├─ pushNew("CheckInterludePhase")
  └─ queueTurnEndPhases(): WeatherEffectPhase → PositionalTagPhase → BerryPhase → CheckStatusEffectPhase → TurnEndPhase

MovePhase(pokemon, targets, move, useMode)  [행동 순서대로 실행]
  ├─ 1차 실패 체크: 수면/냉동/PP/유효성/통나무/기절/봉인/힐블록/목졸림/중력/도발/트릭방/혼란/마비/헤롱헤롱
  │     (여기서 randBattleSeedInt 사용: 냉동 해제 1/4 (`:392`), 완전마비 1/8 (`:524`))
  ├─ PP 소모, "OO의 XX!" 텍스트 표시
  ├─ 2차/3차 실패 체크(날씨/필드/특성 면역 등)
  └─ executeMove() → unshiftNew("MoveEffectPhase", user, targets, move, useMode)
       (명중 판정: user.randBattleSeedInt(100) < 보정된 명중률, src/phases/move-effect-phase.ts:~429)
       (데미지 계산 시 85~100% 스프레드: pokemon.ts:3811, 크리티컬: pokemon.ts:3964)
  └─ end() → unshiftNew("MoveEndPhase", ...) 후 super.end()

MoveEndPhase → (부가 태그 정리 등)

FaintPhase(battlerIndex)  [HP 0 도달 시 unshift됨 — PhaseManager.queueFaintPhase 참조]
  ├─ 부활 아이템(PokemonInstantReviveModifier) 체크
  ├─ PostFaint/PostKnockOut/PostVictory 특성 적용
  ├─ 플레이어 쪽: 남은 합법 포켓몬 없으면 GameOverPhase, 있으면 SwitchPhase 큐잉
  ├─ 적 쪽: unshiftNew("VictoryPhase", ...), 트레이너면 예비 파티 있으면 SwitchSummonPhase
  ├─ (더블) 살아있는 동료에게 이후 타겟 리다이렉트: globalScene.redirectPokemonMoves(...)
  └─ 페인트 연출(트윈/사운드) 이후 pokemon.leaveField()

SwitchPhase → SwitchSummonPhase  [교체 UI → 실제 필드 교체]

TurnEndPhase
  ├─ Battle.incrementTurn() (turn++, turnCommands/preTurnCommands 리셋, battleSeedState=null)
  ├─ 잔불꽃/그래스필드/아이템힐/상태이상 데미지 등 턴 종료 효과
  └─ 큐가 비면 PhaseManager.turnStart()가 자동으로 다음 TurnInitPhase 시작

VictoryPhase(마지막 적 처치 시) → BattleEndPhase(isVictory)
  ├─ 다른 BattleEndPhase 중복 제거
  ├─ battleScore/통계 갱신
  └─ (패배 시가 아니면) SelectModifierPhase(아이템 보상) 큐잉 — **PvE 메타 진행 전용 로직**
```

> 사용자가 나열한 이름 중 코드에 그대로 존재하는 것: `CommandPhase`, `EnemyCommandPhase`, `TurnInitPhase`, `TurnStartPhase`, `MovePhase`, `MoveEndPhase`, `TurnEndPhase`, `SwitchPhase`(+`SwitchSummonPhase`), `FaintPhase`, `BattleEndPhase`. 추가로 실제로 중요한데 언급되지 않은 phase: `SelectTargetPhase`(더블 타겟팅), `MoveEffectPhase`(실제 데미지/효과 적용, `MovePhase`와 분리됨), `CheckInterludePhase`/`WeatherEffectPhase`/`PositionalTagPhase`/`BerryPhase`/`CheckStatusEffectPhase`(턴 종료 체인).

---

## 3. 싱글/더블 배틀 구조

- **단일 플래그**: `Battle.double: boolean`. `BattleType`과는 무관한 별도 축이다(`src/battle.ts:67`).
- **필드 조회는 "파티 앞쪽 N마리 슬라이스"**: `getPlayerField(active?)`/`getEnemyField(active?)`(`src/battle-scene.ts:731-763`)가 `party.slice(0, double ? 2 : 1)`로 구현되어 있다. 즉 "필드 포지션"은 별도 저장 필드가 아니라 **파티 배열에서의 위치로 매 호출마다 파생**된다.
- **`Pokemon.getFieldIndex()`/`getBattlerIndex()`는 추상 메서드**이며 두 서브클래스가 다르게 구현:
  - `PlayerPokemon`: `getFieldIndex() = getPlayerField().indexOf(this)` (0/1), `getBattlerIndex() = fieldIndex` 그대로.
  - `EnemyPokemon`: `getFieldIndex() = getEnemyField().indexOf(this)` (0/1), `getBattlerIndex() = BattlerIndex.ENEMY + fieldIndex` (2/3).
- **동료 조회**: `getAlly()`(`src/field/pokemon.ts:~3367`) = `(isPlayer() ? getPlayerField() : getEnemyField())[fieldIndex ? 0 : 1]` — 더블에서만 의미 있음.
- **명령 저장**: `Battle.turnCommands`가 `BattlerIndex`(0~3, 및 `-1`) 키의 plain object이므로 싱글/더블 모두 동일한 자료구조를 쓰고, 싱글이면 `ENEMY_2`/`PLAYER_2` 키가 단순히 채워지지 않을 뿐이다.
- **더블 전용 로직**:
  - `CommandPhase.handleFieldIndexLogic()`(`command-phase.ts:75-92`): 동료가 BALL/RUN을 선택했으면 자신도 `skip: true`.
  - `SelectTargetPhase`가 `move.allyTargetDefault`면 기본 타겟을 동료로 지정(`select-target-phase.ts:31-36`).
  - `AbilityId.COMMANDER`(도날톡스+또도가스) 특수 처리(`command-phase.ts:98-110`).
  - 포켓몬 페인트 시 동료로 무브 타겟 리다이렉트(`FaintPhase` → `globalScene.redirectPokemonMoves`).
- **속도 순서**는 싱글/더블 구분 없이 `inSpeedOrder(ArenaTagSide.BOTH)` 하나로 처리되며, 더블이면 단순히 대상 배열이 최대 4마리가 될 뿐 로직 분기는 없다.
- **테스트 확인**: `test/helpers/classic-mode-helper.ts`의 `ClassicModeHelper.startBattle(...speciesIds)`는 몇 마리를 넘기냐가 아니라 `game.override.battleStyle("double")` + `Battle.double` 플래그로 싱글/더블이 갈린다. `test/helpers/move-helper.ts`의 `game.move.select(moveId, fieldIndex, targetBattlerIndex)`가 더블에서 필드슬롯/타겟을 명시적으로 받는다.

**결론**: 더블 배틀은 이미 "일반화된 N인용(최대 4)" 구조 위에 올라가 있다. PvP 설계도 처음부터 `BattlerIndex`/`turnCommands`/`Battle.double`을 그대로 따르면, 싱글→더블 확장 시 새 추상화가 필요 없다.

---

## 4. PvP 전환 시 발생하는 핵심 문제

| 영역 | 현재 코드가 가정하는 것 | PvP에서 깨지는 지점 |
|---|---|---|
| 진영 표현 | `Pokemon`의 서브클래스는 `PlayerPokemon`/`EnemyPokemon` 단 2개(`isPlayer(): this is PlayerPokemon`) | "사람 2가 조종하는 포켓몬"을 표현할 3번째 클래스가 없음. 상대 플레이어를 로컬에서 `EnemyPokemon`으로 표현할 수밖에 없는데, `EnemyPokemon`에는 `trainerSlot`, AI 관련 필드(`aiType` 등)가 붙어있어 완전히 깨끗하지 않음 |
| 적 명령 결정 | `EnemyCommandPhase`(`src/phases/enemy-command-phase.ts`)가 **항상** `trainer.getPartyMemberMatchupScores`/`enemyPokemon.getNextMove()`로 AI가 명령을 만든다 | 사람 상대에게는 AI 호출을 하면 안 되고, 네트워크로 받은 명령을 그대로 주입해야 함. `EnemyCommandPhase.start()`를 그대로 쓸 수 없고 대체 Phase가 필요 |
| RNG 시드 발급 | `Battle.battleSeed = randomString(16, true)`(`battle.ts:81`)를 **각 클라이언트가 스스로** 생성 | 두 클라이언트가 각자 다른 `battleSeed`를 만들면 크리티컬/명중/AI 등 모든 판정이 갈라짐. 반드시 서버가 발급한 동일 시드를 공유해야 함 |
| 배틀 상태 소유권 | `Battle`/`Arena`/`Pokemon.hp` 등 모든 상태가 로컬 `globalScene`에만 존재하고, 이를 신뢰할 "제3자"가 없음(싱글플레이어 게임이므로 자기 자신을 못 속여도 상관없음) | 클라이언트가 자기 HP/데미지를 조작해도 막을 방법이 코드에 전혀 없음. PvP에서는 최소한 "상대에게 전달되는 결과"는 클라이언트가 임의로 조작할 수 없어야 함 |
| 턴 대기 | `TurnInitPhase`가 **로컬에서 즉시** 모든 슬롯의 `CommandPhase`/`EnemyCommandPhase`를 순차 push — 네트워크 지연으로 "상대가 아직 명령을 안 보냄" 상태가 없음 | 원격 플레이어의 명령이 도착할 때까지 기다리는 대기 상태/타임아웃 개념을 새로 추가해야 함 |
| 스위치 강제/자원 | `SwitchPhase`가 `globalScene.getPokemonAllowedInBattle()`(로컬 파티 전체)를 참조 | PvP에서는 "허용된 포켓몬"이 상대에게 보여선 안 되는 정보(파티 구성)를 포함할 수 있음(6장/7장 참조) |
| 페인트/승패 판정 | `FaintPhase`가 플레이어 패배 시 `GameOverPhase`(세이브데이터/런 종료로 연결), 적 패배 시 `VictoryPhase`→`BattleEndPhase`(경험치/아이템 보상, `SelectModifierPhase`) | PvP 1:1 듀얼에는 "런 게임오버"도 "웨이브 보상"도 의미가 없음(혹은 다른 방식으로 설계해야 함). 이 경로를 그대로 타면 세이브데이터가 오염됨 |
| 타겟 지정 | `SelectTargetPhase`가 UI 콜백 기반으로 동기적으로 로컬에서 완결 | 더블 PvP에서 "상대가 어떤 포켓몬을 타겟했는지"도 동기화 대상이며, 명령 자체에 포함되어야 함(이미 `TurnCommand.targets: BattlerIndex[]`가 있어 구조적으로는 재사용 가능) |
| 게임 모드 진행 | `GameMode`(`src/game-mode.ts`)와 `BattleScene.newBattle()`이 웨이브/바이옴 기반 로그라이크 진행에 강결합 | PvP는 웨이브 진행이 없는 "고정 1회성 배틀"이므로 `newBattle()`의 웨이브 파생 로직(레벨 계산, 바이옴 조우 생성 등)을 타면 안 됨 |
| 보상/경험치 | `ExpPhase`/`PartyExpPhase`/`BattleEndPhase`의 `SelectModifierPhase`가 PvE 보상 체계에 연결 | 기본적으로 비활성화하거나(랭크 포인트 등 PvP 전용 보상으로 대체) 완전히 우회해야 함 |
| 전역 싱글턴 | `globalScene` 하나 = 배틀 인스턴스 하나 | 서버가 여러 PvP 매치를 동시에 시뮬레이션하려면 이 가정이 근본적으로 막힘(5장) |

---

## 5. 서버 Authoritative 설계

### 5.1 근본적인 제약: "엔진 재사용"과 "서버가 직접 시뮬레이션"은 동시에 만족하기 어렵다

`BattleScene`은 `Phaser.Scene`을 상속하고, `FaintPhase`/`MovePhase` 등 로직 Phase들이 **연출 호출(트윈, 사운드, UI 모드 전환)을 로직과 같은 메서드 안에 직접 섞어서** 호출한다. 이 엔진을 Node.js 서버 프로세스에서 렌더링 없이 그대로 실행하려면:

- (A) 서버에서 실제로 Phaser(+headless canvas 등)를 구동해 클라이언트와 동일한 코드를 그대로 실행 — 무겁고 비정상적인 서버 아키텍처이며, 렌더링/오디오 부작용을 서버에서 no-op으로 만드는 어댑터 레이어가 필요.
- (B) 로직과 렌더링을 완전히 분리하는 대규모 리팩터 — "기존 PvE를 깨지 않는다"는 원칙과 정면 충돌하는 리스크 큰 작업이며 MVP 범위를 크게 초과.

두 옵션 모두 이번 MVP에 적합하지 않다. 따라서 **"서버가 Move/Ability 코드를 직접 실행한다"는 좁은 의미의 authoritative는 MVP 목표에서 제외**하고, 아래 5.2의 절충안을 기본 설계로 제안한다.

### 5.2 제안 아키텍처: "결정론적 듀얼 클라이언트 락스텝 + 서버 입력 중재/검증"

핵심 아이디어: **엔진(Move/Ability/데미지 계산)은 두 클라이언트가 각각 로컬에서, 완전히 동일한 입력(명령+시드+순서)으로 독립 실행한다. 서버는 그 "입력"을 중재·검증하고, 두 클라이언트의 "결과"가 일치하는지 매 턴 대조한다.** 이렇게 하면 사용자가 요구한 다음 두 조건을 모두 만족한다:

- "서버가 명령을 수신하고, 서버가 결과를 결정한 뒤 양쪽에 동기화" → **서버가 결정하는 것은 "턴을 구성하는 입력값"(양측 명령, 공유 RNG 시드, 명령 도착 순서·유효성)이며, 이 입력이 정해지면 결과는 수학적으로 유일하게 결정된다(엔진이 결정론적이므로). 서버는 이 입력을 양쪽에 동일하게 전달함으로써 "결과를 결정"한다.**
- "두 클라이언트가 독립 계산해서 다른 상태가 되는 구조를 피한다" → **매 턴 종료 시 양쪽이 배틀 상태 해시(체크섬)를 서버에 보고하고, 서버가 두 해시를 대조한다. 불일치 시 해당 매치를 즉시 무효화/재동기화하고, 어느 쪽이 이상값을 보냈는지 로그로 남긴다(12장 참조).**

```
[Client A]                     [Server]                     [Client B]
  UI 입력(FIGHT, move, target)
      │
      ├── SELECT_MOVE ─────────────▶ 명령 유효성 검증(무브 보유/PP/기절 여부)
      │                               ├─ 양쪽 명령이 모두 도착할 때까지 보관(동시 공개)
      │                               │
      │                          모두 도착하면:
      │                          TURN_RESOLVE 메시지 생성
      │                          { turn, seed, commands: {P1,P2,...}, order-hint }
      │◀──────────── TURN_RESOLVE ────┤──────────── TURN_RESOLVE ───────────▶
      │                                                                      │
  로컬 엔진 실행                                                        로컬 엔진 실행
  (기존 CommandPhase 결과를 turnCommands에 그대로 채운 뒤                (동일)
   TurnStartPhase 이하를 기존 코드 그대로 재생)
      │                                                                      │
      ├── STATE_HASH(turn, hash) ────▶ 두 해시 대조 ◀──────────────── STATE_HASH
      │                               일치 → ACK, 다음 턴 진행
      │                               불일치 → RESYNC / 매치 무효화
```

- "명령 동시 공개"는 커밋-리빌 성격을 가진다: 서버는 **양쪽 명령이 모두 도착하기 전까지 어느 쪽에도 상대 명령을 보내지 않는다.** 이는 "상대가 아직 명령을 안 냈다"는 정보 외에는 노출하지 않으므로, 조작된 클라이언트가 상대 명령을 먼저 훔쳐보고 유리하게 대응 선택하는 것을 막는다(12장).
- 명령이 서버를 반드시 거치므로, 서버는 **명령 자체의 합법성**(그 포켓몬이 그 기술을 배웠는가, PP가 남았는가, 이미 기절한 포켓몬이 아닌가 등)을 `turnCommands`에 반영되기 *전에* 검증할 수 있다. 이는 엔진을 그대로 재사용하면서도 얻을 수 있는 최소한의 authoritative 성격이다.
- **잔여 리스크**: 이 설계는 "조작된 클라이언트가 자기 자신에게 유리한 로컬 계산 결과를 상대에게 강요"하는 것은 막지만(해시 불일치로 걸림), "정직한 두 클라이언트가 똑같이 계산하되 그 계산 자체가 조작된 입력에서 출발"하는 경우까지는 못 막는다. 이는 5.1에서 설명한 근본적 트레이드오프이며, **13장에서 장기 로드맵(엔진 코어를 렌더링과 분리해 서버에서도 순수 시뮬레이션 가능하게 만드는 리팩터)으로 명시한다.**

### 5.3 서버가 반드시 알아야 하는 상태 vs 클라이언트가 가져도 되는 상태

| 상태 | 서버 소유(authoritative) | 클라이언트 A/B 공개 여부 |
|---|---|---|
| 매치의 `battleSeed` | 서버 발급(§8) | 양쪽 모두 공개(결과 재현에 필요) |
| 양쪽의 이번 턴 명령 | 서버가 수신·검증·동시 공개 | 자기 명령은 즉시, 상대 명령은 **양쪽 다 제출 완료된 후에만** |
| 양쪽 파티 전체 구성(6마리) | 서버가 매치 시작 시 각 클라이언트로부터 제출받아 보관 | **상대 파티의 "아직 필드에 내지 않은 포켓몬" 정보는 비공개**(7장) |
| 필드에 나온 포켓몬의 HP/상태이상/랭크업 | 서버가 양쪽 해시로 교차검증만 하고 값 자체는 신뢰(엔진이 결정론적이므로 별도 계산 불필요) | 양쪽 공개 |
| 각 포켓몬의 정확한 개체값(IV)/성격/특성 | 서버 보관(매치 시작 시 스냅샷 고정) | 공개 여부는 정책 결정 사항(실제 포켓몬 게임처럼 비공개 유지 가능) — 최소한 "상대가 아직 안 낸 포켓몬"은 비공개 |
| 연결 상태(재접속 토큰 등) | 서버 | 비공개 |

### 5.4 상대에게 공개하면 안 되는 정보 처리

- **필드 밖 파티 정보**: `getPlayerField()`/`getEnemyField()`가 파티 앞쪽 N마리만 노출하는 기존 구조를 활용해, **서버가 클라이언트로 내려주는 "상대 파티" 데이터는 항상 "현재 필드에 나온 슬롯 + 지금까지 필드에 나왔던 이력"만 포함**하고 나머지는 `null`/미공개로 마스킹한다. (`Battle.seenEnemyPartyMemberIds: Set<number>`가 이미 "지금까지 본 적 파티원"을 추적하는 필드로 존재 — `src/battle.ts:66` — 이 개념을 그대로 "상대에게 공개된 포켓몬 집합"으로 재사용 가능.)
- **다음 스위치 대상**: 스위치 명령의 `cursor`(파티 내 인덱스)는 상대에게 그대로 노출하면 "다음 턴 뭐가 나올지" 유추될 수 있는 정보는 아니지만(스위치 자체가 이번 턴에 즉시 반영됨), **커밋-리빌 타이밍**(5.2)을 지키면 "상대가 스위치할지 기술을 쓸지"를 미리 알 수 없다는 것만으로 충분.
- **PP/기술 조합**: 상대가 아직 쓰지 않은 기술은 실제로는 겉으로 드러나지 않게 할 수도 있으나(정식 포켓몬 대전처럼), MVP에서는 구현 단순화를 위해 "필드에 나온 순간부터 그 포켓몬의 알려진 기술 4개는 공개"로 시작하고, 정보 비공개 수준은 후속 정책 과제로 남긴다(13장).

---

## 6. 네트워크 프로토콜 설계

### 6.1 전송 계층

- 저장소에 WebSocket 관련 코드가 전혀 없으므로 신규 구축. `src/api/api-base.ts`의 `ApiBase` 패턴(공통 헤더 주입, 세션 인증)을 참고해 새 `src/net/battle-socket-client.ts`(가칭, `#net/*` alias 신설 제안, 9장)를 만든다.
- 인증: 기존 세션 쿠키(`SESSION_ID_COOKIE_NAME`, `src/account.ts`)를 WebSocket 핸드셰이크 시 쿼리스트링 또는 최초 `AUTH` 메시지로 전달해 서버가 `PokerogueAccountApi`와 동일한 세션 검증을 재사용하도록 서버 쪽에 요청.

### 6.2 메시지 목록

| 메시지 | 발신 → 수신 | 발생 시점 | 페이로드(핵심 필드) | 서버 처리 | 클라이언트 처리 |
|---|---|---|---|---|---|
| `CREATE_ROOM` | Client → Server | "PvP 방 만들기" 클릭 | `{ mode: "single" \| "double" }` | 방 생성, `roomId` 발급 | 대기 화면 표시 |
| `JOIN_ROOM` | Client → Server | 초대 코드/매칭으로 참가 | `{ roomId }` | 인원 검증(정원 2), 참가자 등록 | 대기 화면 갱신 |
| `LEAVE_ROOM` | Client → Server | 대기 중 이탈 | `{ roomId }` | 방 해제/상대에게 통지 | — |
| `SUBMIT_TEAM` | Client → Server | 방 입장 후 팀 선택 완료 | `{ roomId, pokemon: PvpPartyMemberDto[] }` (species, level, IV, 성격, 특성, 기술 4개, 지닌물건) | 규칙 검증(레벨 캡 등), 저장, `READY` 후보로 표시 | — |
| `READY` | Client → Server | 팀 확정 버튼 | `{ roomId }` | 양쪽 `READY` 확인되면 `BATTLE_START` 트리거 | — |
| `BATTLE_START` | Server → Client (양쪽) | 양쪽 READY 완료 | `{ battleSeed, opponentPublicTeam, yourBattlerIndex, double }` | — | `BattleScene`에 PvP 전용 `Battle`/`Arena` 구성(§9), `CommandPhase`부터 로컬 엔진 시작 |
| `SELECT_MOVE` | Client → Server | `CommandPhase`에서 FIGHT 확정 | `{ roomId, turn, fieldIndex, moveId, targets: BattlerIndex[] }` | 합법성 검증 후 보관(상대 것과 매칭 대기) | — |
| `SELECT_SWITCH` | Client → Server | POKEMON 커맨드 확정 | `{ roomId, turn, fieldIndex, partyIndex }` | 동일 | — |
| `SELECT_OTHER` | Client → Server | RUN/TERA 등 기타 커맨드(§6.3) | `{ roomId, turn, fieldIndex, command, args }` | 동일 | — |
| `TURN_READY` | Server → Client (양쪽, 동시) | 양쪽 명령이 모두 도착 | `{ turn, commands: { [BattlerIndex]: TurnCommandDto } }` | — | 로컬 `turnCommands`에 그대로 주입 후 기존 `TurnStartPhase` 그대로 실행(§9) |
| `STATE_HASH` | Client → Server | 로컬 `TurnEndPhase` 종료 직후 | `{ turn, hash }` | 양쪽 해시 비교 | — |
| `STATE_ACK` | Server → Client (양쪽) | 해시 일치 확인 | `{ turn }` | — | 다음 턴 진행 허용(선택적 게이팅) |
| `RESYNC_REQUIRED` | Server → Client | 해시 불일치 | `{ turn, canonicalSnapshot? }` | 불일치 로그, 재시도 또는 몰수패 판정(12장) | 스냅샷으로 강제 롤백 또는 매치 종료 안내 |
| `BATTLE_EVENT` | Server → Client (양쪽) | 명중/실패/특성 발동 등 표시용 부가 이벤트 필요 시(§7 참고 — MVP에서는 클라이언트가 로컬 계산 결과로 자체 연출하므로 이 메시지는 **연출 텍스트 보정용 옵션**) | `{ turn, kind, data }` | — | 로그/텍스트 보정 |
| `BATTLE_END` | Server → Client (양쪽) | 한쪽 전멸 확정(로컬 `VictoryPhase`/`GameOverPhase` 진입 시 보고) | `{ winner: BattlerIndex, reason }` | 매치 결과 기록(랭크 등) | 결과 화면, 방 정리 |
| `DISCONNECT` | Server → Client (남은 쪽) | 상대 소켓 종료 감지 | `{ roomId, disconnectedSide, graceSeconds }` | 재접속 유예 타이머 시작 | "상대 연결 끊김, N초 대기" UI |
| `RECONNECT` | Client → Server | 재접속 시도 | `{ roomId, lastKnownTurn }` | 세션 매칭, 현재까지의 `TURN_READY` 로그 재전송 | 로컬 상태를 서버 스냅샷 기준으로 재구성(§9) |
| `FORFEIT` | Client → Server | 기권 | `{ roomId }` | 즉시 `BATTLE_END(winner=상대)` | — |

### 6.3 기존 `Command` enum과의 매핑

`src/enums/command.ts`의 `Command { FIGHT, BALL, POKEMON, RUN, TERA }` 중 PvP 듀얼에서는 `BALL`(포획)은 원천 차단(`BattleType.PVP` 신설 후 `checkCanUseBall()`/`command-phase.ts:390-391` 유사 분기 추가), `RUN`은 정책에 따라 금지 또는 "기권" 대체(트레이너전과 동일하게 `handleRunCommand()`를 막는 방식이 자연스러움). 따라서 실제 네트워크로 오가는 커맨드는 사실상 `FIGHT`/`POKEMON`/`TERA` 3종으로 좁혀진다. → `SELECT_MOVE`/`SELECT_SWITCH`로 분리한 이유이며, `TERA`는 `SELECT_OTHER`로 묶어 확장 여지를 남긴다.

---

## 7. Battle State 동기화 구조

"통째로 JSON 직렬화해서 보낸다"를 피하기 위해, **1.5절에서 정리한 기존 리셋 스코프(배틀 전체/웨이브/필드체류/턴)를 그대로 동기화 계층으로 재사용**한다.

### 7.1 매치 시작 시 1회만 교환 (고정 데이터)

- 서버 발급 `battleSeed`(§8)
- 상대 파티 중 "공개 정책"에 해당하는 필드: 종족, 레벨, 성별, (정책에 따라) 특성/타입/지닌물건. **개체값/정확한 스탯/정확한 성격 보정치는 비공개**(원한다면 "범위"만 공개하는 정책도 가능 — 후속 과제).

### 7.2 매 턴 명령 단계에서 교환

- `TurnCommand`(`src/battle.ts:41-48`)의 필드를 그대로 DTO화: `command`, `move.move`(`MoveId`), `move.targets`(`BattlerIndex[]`), `cursor`(스위치 대상 인덱스). **이 구조체가 이미 싱글/더블을 모두 지원하므로 신규 설계가 필요 없다.**

### 7.3 매 턴 종료 후 검증용 해시 (전체 전송 금지, 해시만)

해시에 포함해야 하는 필드(=결과에 영향을 주는 모든 것), `PokemonTurnData`/`PokemonSummonData`/`PokemonBattleData`/`Arena` 스코프 기준으로 정리:

| 대상 | 필드 | 근거 |
|---|---|---|
| 각 필드 포켓몬 | `hp`, `status?.effect`, `status?.toxicTurnCount` 등 | `field/pokemon.ts:220,230` |
| 각 필드 포켓몬 | `summonData.statStages[7]` | `pokemon-data.ts:103` |
| 각 필드 포켓몬 | `summonData.tags`(배틀러 태그: 혼란/씨뿌리기 등) 종류+잔여턴 | `pokemon-data.ts:112` |
| 각 필드 포켓몬 | 현재 PP(`moveset[i].ppUsed`) | — |
| 각 필드 포켓몬 | `switchOutStatus` | `field/pokemon.ts:260` |
| Arena | `weather?.weatherType`, `terrain?.terrainType`, `tags[].tagType`+잔여턴 | `field/arena.ts:62,63,66` |
| Battle | `turn`, `double`, 생존 파티 수 | `battle.ts` |

- 해시는 위 값들을 정규화된 순서(고정 키 순서)로 직렬화한 뒤 SHA-256 등으로 축약. **원본 전체를 서버로 보내지 않는 것이 핵심**(대역폭 절약 + 정보 비공개 유지).
- 불일치 시에만(드문 경우) 전체 스냅샷을 서버로 업로드해 사후 분석/재동기화에 사용(§12).

### 7.4 동기화하지 않아도 되는 것 (로컬 전용)

- 스프라이트 좌표/애니메이션/트윈, 사운드, 텍스트 로그의 정확한 연출 타이밍 — 각 클라이언트가 동일 로직으로 동일 결과를 내므로 **연출은 각자 로컬에서 独立 재생**하면 되고 프레임 단위로 맞출 필요 없음(비동기 애니메이션 차이는 허용).
- `PokemonTempSummonData.turnCount`/`waveTurnCount`(`pokemon-data.ts:261`) 같은 UI 커서 기억용 값.

---

## 8. RNG / 결정론 처리 방식

### 8.1 현재 구조 (근거: `src/utils/common.ts`, `src/battle.ts:493-511`, `src/battle-scene.ts:2010-2030`)

- `randSeedInt`/`randSeedFloat`/`randSeedItem`/`randSeedShuffle`/`randSeedGauss`(`src/utils/common.ts`)는 모두 **`Phaser.Math.RND`(시드 가능한 내장 PRNG)를 감싼 결정론적 함수**다. 반대로 `randInt`/`randGauss`/`randItem`은 `Math.random()` 기반이며 코드 주석에 "전투에는 쓰면 안 됨"이라고 명시되어 있다.
- 시드는 3단계 계층: **글로벌 런 시드**(`BattleScene.seed`) → **웨이브 시드**(`waveSeed = shiftCharCodes(seed, wave)`, `resetSeed()`) → **배틀/턴 시드**(`Battle.battleSeed`, 배틀 생성 시 1회 고정, `Battle.randSeedInt()`가 턴마다 `battleSeed`를 `turn << 6`만큼 shift해 독립된 RNG 스트림을 재구성).
- `Battle.randSeedInt()`(`battle.ts:493-511`)는 **호출할 때마다 전역 `Phaser.Math.RND` 상태를 백업 → 배틀 시드로 교체(또는 캐시된 `battleSeedState` 복원) → 값 생성 → 원래 전역 상태로 복원**하는 부수효과 기반 구현이다. 이 덕분에 "이번 배틀·이번 턴"의 RNG 스트림이 월드 생성용 RNG(`waveSeed`)를 오염시키지 않는다.
- 실제 전투 판정에서 소비되는 RNG(전부 `randBattleSeedInt`/`randBattleSeedIntRange` 경유):
  - 데미지 스프레드 85~100%: `pokemon.ts:3811`
  - 크리티컬 판정: `pokemon.ts:3964`
  - 명중 판정: `move-effect-phase.ts:~429`
  - 완전마비(1/8): `move-phase.ts:524`
  - 혼란 자해(1/3): `move-phase.ts:~908`
  - 냉동 해제(1/4): `move-phase.ts:392`
  - 잠듦 지속 턴수: `pokemon.ts:5111`
  - 포획/도주 판정: `attempt-capture-phase.ts`, `attempt-run-phase.ts` (PvP에서는 §6.3에 따라 비활성 예정)
  - 적 AI 기술/타겟 선택: `pokemon.ts:6752,6902-6920,7020` (PvP에서는 이 경로 자체가 `EnemyCommandPhase` 대신 네트워크 입력으로 대체되므로 **호출되지 않음** — 순서 정합성에 영향 없음)
- 선례: 데일리런은 이미 **서버가 시드를 발급**하는 구조를 갖고 있다(`src/api/daily-api.ts`의 `getSeed(): GET /daily/seed` → `title-phase.ts`의 `initDailyRun()`이 `globalScene.setSeed(seed); globalScene.resetSeed();` 호출).

### 8.2 PvP에 적용할 방식: 서버 발급 시드 + 클라이언트 결정론적 재생

- **선택**: "서버가 매치 생성 시 `battleSeed`를 1회 발급하고, 두 클라이언트가 동일한 `Battle.battleSeed`로 초기화한다." (순수 서버 RNG도, 매 판정마다 RNG 결과를 이벤트로 전송하는 방식도 아님.)
- **이 방식을 고른 이유**:
  1. `Battle.randSeedInt()`가 이미 "턴 번호"만으로 결정론적으로 재구성 가능한 스트림이므로, 시드 하나만 공유하면 **턴 순서대로 같은 명령을 넣었을 때 완전히 같은 난수열이 나온다는 것이 기존 코드로 이미 보장**된다. 별도의 "RNG 결과 이벤트 전송" 프로토콜이 필요 없다.
  2. `/daily/seed`(`src/api/daily-api.ts`)로 "서버가 시드를 발급하고 클라이언트가 로컬에서 그 시드로 결정론적 재생"하는 패턴이 이미 검증되어 있어, **같은 패턴을 그대로 복제**하면 된다(`PokerogueDailyApi`와 같은 위치에 `PokerogueBattleApi.getSeed(roomId)` 또는 `BATTLE_START` 메시지 페이로드에 시드를 직접 포함).
  3. 매 판정마다 RNG 결과를 서버가 계산해 이벤트로 뿌리는 방식은 서버가 실제로 "언제 어떤 RNG가 얼마나 소비되는지"(무브 효과별로 호출 횟수가 다름)까지 알아야 하므로, 5.1에서 밝힌 "서버가 엔진을 직접 실행할 수 없다"는 제약과 충돌한다. 반면 시드 공유 방식은 **엔진 내부 RNG 소비 순서에 서버가 개입할 필요가 전혀 없다.**
- **유일한 코드 변경 지점**: `Battle` 생성자(`src/battle.ts:111-127`)에서 `battleSeed: string = randomString(16, true)`로 로컬 생성하는 부분을, PvP 배틀 생성 경로에서만 `BATTLE_START`로 받은 시드를 주입하도록 분기(§9의 신규 `Battle` 서브클래스 또는 생성자 옵션으로 처리, 기존 PvE 경로는 완전히 그대로 둠).
- **검증**: §7.3의 매 턴 해시 대조가 "시드가 실제로 동일하게 소비되고 있는지"를 사실상 검증하는 역할을 겸한다 — 한쪽이 다른 시드를 쓰면 첫 RNG 판정부터 상태가 갈라져 해시가 즉시 불일치한다.

---

## 9. 파일 구조 설계

### 9.1 신규 파일 (클라이언트, 이 저장소)

```
src/
  net/                                  # 신규 alias "#net/*" 제안 (tsconfig.json paths에 추가)
    battle-socket-client.ts             # WebSocket 연결/재접속/메시지 (de)serialize. src/api/api-base.ts의
                                         # 인증 헤더/세션 재사용 패턴을 참고하되 fetch 대신 WebSocket
    pvp-protocol-types.ts               # §6의 메시지 payload 타입 (서버와 공유할 스키마의 클라이언트측 사본)
    pvp-room-manager.ts                 # CREATE_ROOM/JOIN_ROOM/READY 상태머신 (UI ↔ 소켓 중개)
    battle-state-hasher.ts              # §7.3 해시 계산 (읽기 전용, globalScene.currentBattle을 순회)

  phases/
    remote-command-wait-phase.ts        # 신규 Phase: 원격 플레이어의 명령이 서버에서 TURN_READY로
                                         # 돌아올 때까지 대기. EnemyCommandPhase를 대체(§9.3)
    pvp-battle-end-phase.ts             # 신규 Phase: 기존 BattleEndPhase의 PvE 보상 로직(§4의 "보상/경험치")을
                                         # 타지 않는 PvP 전용 종료 처리 (BATTLE_END 메시지 발신 포함)

  data/
    pvp-battle.ts                       # `Battle`을 상속하는 `PvpBattle` (battleSeed를 서버 발급값으로
                                         # 오버라이드하는 생성자만 다름 — battle.ts 자체는 미수정)

  ui/handlers/
    pvp-room-ui-handler.ts              # 방 생성/참가/팀 선택 UI (기존 ui-handlers 패턴 재사용)
    pvp-waiting-ui-handler.ts           # "상대 명령 대기 중" / "연결 끊김, 재접속 대기 중" 표시

  enums/
    (수정) battle-type.ts               # `BattleType.PVP` 추가

server/  (별도 저장소일 가능성이 높음 — 6장 각주 참고)
  src/pvp/
    room.ts, matchmaking.ts, turn-arbiter.ts, seed-issuer.ts, state-hash-verifier.ts, reconnect-manager.ts
```

> **중요**: `src/api` 조사 결과 이 저장소에는 서버 코드가 전혀 없고(`.gitmodules`에도 없음), 서버는 `VITE_SERVER_URL`로만 가리키는 완전히 별개의 저장소다. 따라서 "서버 authoritative 로직" 자체의 실제 구현은 **이 저장소 밖(별도 서버 저장소)** 에 위치해야 하며, 위 `server/` 트리는 어느 서버 저장소에 대응되는 트리인지 예시일 뿐, 이 클라이언트 PR에는 포함되지 않는다.

### 9.2 수정할 기존 파일과 이유

| 파일 | 수정 내용 | 이유 | 기존 기능 영향 |
|---|---|---|---|
| `src/enums/battle-type.ts` | `BattleType.PVP` 추가 | `checkCanUseBall`(`command-phase.ts:354-399`), `handleRunCommand`(`:579-597`), `getBgmOverride`(`battle.ts:246-485`) 등 `switch(battleType)` 분기에서 PvP 전용 처리를 추가하려면 값 자체가 있어야 함 | enum에 값 추가는 **비파괴적**(기존 `switch`문에 `case`가 없으면 기존 동작 유지, `default`/미매칭 시 기존 분기 그대로) |
| `src/phases/command-phase.ts` | `checkCanUseBall()`/`handleRunCommand()`에 `BattleType.PVP` 분기 추가(포획 항상 불가, 도주는 정책에 따라 기권 처리) | §4 "포켓볼/도주" 문제 해결 | 기존 `WILD`/`TRAINER`/`MYSTERY_ENCOUNTER` 분기 로직은 **한 줄도 건드리지 않음** |
| `src/phases/turn-init-phase.ts` | 적 슬롯에 대해 `EnemyCommandPhase` 대신 `RemoteCommandWaitPhase`를 push하는 분기 (`globalScene.currentBattle.battleType === BattleType.PVP`일 때만) | §4 "적 명령 결정" 문제 해결 | 조건부 분기이므로 PvE 경로(`else`)는 기존 코드 그대로 |
| `src/battle.ts` | `Battle` 생성자에서 `battleSeed`를 옵션으로 주입 가능하게(기본값은 기존 `randomString(16, true)` 유지) — 혹은 9.1의 `PvpBattle` 서브클래스로 완전히 분리해 이 파일은 **아예 수정하지 않는 안**도 가능(권장) | §8 서버 발급 시드 적용 | 서브클래스 방식을 택하면 이 파일 수정량 0 |
| `src/battle-scene.ts` | `newBattle()`과 별개로 `newPvpBattle(seed, opponentTeam, double)` 같은 신규 메서드 추가(기존 `newBattle()`의 웨이브/바이옴 파생 로직은 호출하지 않음) | §4 "게임 모드 진행" 문제 해결 — PvP는 웨이브 기반 생성 파이프라인을 타면 안 됨 | 완전히 새 메서드 추가이므로 기존 `newBattle()` 미변경 |
| `src/phases/battle-end-phase.ts` | 수정 없음(대신 9.1의 `PvpBattleEndPhase` 신규 Phase로 완전히 우회) | §4 "보상/경험치" 문제 | 기존 파일 미변경 — PvE 무결성 최우선 원칙에 부합 |
| `tsconfig.json` | `paths`에 `"#net/*": ["./src/net/*.ts"]` 추가 | 신규 모듈 alias | 추가 항목이므로 비파괴적 |
| `test/helpers/` | (후속) `pvp-mode-helper.ts` 신규 — 기존 `classic-mode-helper.ts` 패턴을 본떠 PvP 통합테스트 헬퍼 작성 | 테스트 가능성 확보 | 신규 파일 |

### 9.3 `EnemyCommandPhase` 대체 전략 (설계의 핵심 디테일)

`TurnInitPhase`(`src/phases/turn-init-phase.ts:59-73`)의 다음 부분:

```ts
globalScene.getField().forEach((pokemon, i) => {
  if (pokemon?.isActive()) {
    if (pokemon.isPlayer()) {
      globalScene.phaseManager.pushNew("CommandPhase", i);
    } else {
      globalScene.phaseManager.pushNew("EnemyCommandPhase", i - BattlerIndex.ENEMY);
    }
  }
});
```

PvP에서는 이 `else` 분기만 `battleType === BattleType.PVP` 여부로 다시 갈라 `RemoteCommandWaitPhase(fieldIndex)`를 push한다. 이 신규 Phase는:

1. `net/battle-socket-client.ts`에 "이번 턴의 원격 명령 도착"을 구독.
2. `TURN_READY` 메시지가 도착하면 해당 `BattlerIndex`의 `TurnCommand`를 **`EnemyCommandPhase`가 직접 채우던 것과 완전히 동일한 형태로** `globalScene.currentBattle.turnCommands[fieldIndex + BattlerIndex.ENEMY]`에 기록.
3. `this.end()` 호출.

이렇게 하면 **`TurnStartPhase` 이후의 모든 코드(`MovePhase`, `MoveEffectPhase`, `FaintPhase` 등 전투의 실질적인 부분)는 단 한 줄도 수정하지 않고 그대로 재사용**된다. 이는 "기존 엔진 재사용 최대화" 원칙을 코드 레벨에서 구체화한 것이다.

---

## 10. 싱글 PvP MVP 개발 순서

**목표**: "두 명이 방에 들어와서 싱글 포켓몬 1마리씩 가지고 온라인 배틀을 끝까지 진행할 수 있다."

| 단계 | 작업 | 포함 | 후순위(MVP 제외) |
|---|---|---|---|
| 0 | 서버 저장소에 PvP 룸/시드/중재 서비스 골격 (§9.1의 `server/` 트리) | `CREATE_ROOM`/`JOIN_ROOM`/`READY`/`battleSeed` 발급 | 매치메이킹 알고리즘(초기엔 랜덤/코드 입력 매칭으로 충분), 랭크 포인트 |
| 1 | 클라이언트 `#net` 모듈 + `pvp-room-ui-handler` | 방 만들기/참가 UI, 팀 1마리 선택(레벨/스탯 고정 템플릿으로 시작해도 됨) | 파티 6마리 빌더, 밴/드래프트 |
| 2 | `BattleType.PVP` 추가 + `newPvpBattle()` | §9.2 표의 enum/battle-scene 변경 | 웨이브/바이옴 연동 일체 |
| 3 | `RemoteCommandWaitPhase` + `TurnInitPhase` 분기 | §9.3 그대로 | 더블 관련 동료 스킵 로직 확장(11장에서) |
| 4 | 서버 시드 주입 (`PvpBattle`) | §8.2 | 시드 재사용/리플레이 저장 |
| 5 | `SELECT_MOVE`/`TURN_READY` 왕복 | §6.2 핵심 메시지만 | `SELECT_SWITCH`(1마리뿐이므로 교체 UI 자체가 없음 — 자동으로 후순위) |
| 6 | 데미지/명중/기절까지 정상 진행 확인 | 기존 `MovePhase`~`FaintPhase` 그대로 재생되는지 통합테스트 | — |
| 7 | `STATE_HASH` 대조 (§7.3) | 최소 필드(HP/상태이상/PP)만으로 시작 | 전체 필드 해시, 위조 탐지 고도화(§12) |
| 8 | 승패 판정 → `PvpBattleEndPhase` → `BATTLE_END` | 결과 화면만, 보상 없음 | 랭크 갱신, 리플레이 |
| 9 | `DISCONNECT`/`RECONNECT`/유예 타이머 | 최소: 유예 후 자동 몰수패 | 정교한 상태 롤백/재생 |
| 10 | `FORFEIT`(기권) | 버튼 하나 | — |

이 순서는 "각 단계가 끝날 때마다 실제로 플레이 가능한 증분"이 되도록 짰다(0~3까지 되면 로컬 두 창으로 테스트 가능, 4~6까지 되면 시드 동기화 검증 가능, 7 이후부터 "치팅 방지" 요소가 붙기 시작).

---

## 11. 더블 PvP 확장 계획

3장에서 확인했듯 기존 코드는 이미 최대 4슬롯(`BattlerIndex`)을 전제로 짜여 있으므로, **MVP 설계에서 아래를 처음부터 "싱글 전용으로 하드코딩"하지 않으면** 더블 확장 시 재설계가 필요 없다.

- **Command model**: `TurnCommand`(`src/battle.ts`)를 그대로 쓰되, `SELECT_MOVE` 등 네트워크 메시지의 `fieldIndex`가 처음부터 `0|1`(더블 대비)을 받을 수 있는 타입으로 정의(싱글 MVP에서는 항상 0만 오지만 타입은 좁히지 않음).
- **Target model**: `TurnCommand.targets: BattlerIndex[]`를 그대로 사용 — 이미 `SelectTargetPhase`가 더블 타겟팅을 완전히 구현하고 있으므로 **네트워크 메시지의 `targets` 필드도 처음부터 배열로 설계**(§6.2에 이미 반영됨).
- **Turn model**: `RemoteCommandWaitPhase`가 대기해야 할 원격 명령 개수를 `Battle.getBattlerCount()`(더블이면 2)만큼으로 일반화 — 싱글 MVP에서는 1로 동작.
- **Battle state**: `Battle.double`을 매치 생성 시 `BATTLE_START` 페이로드의 `double: boolean`으로 그대로 설정. `PvpBattle` 생성자가 이 값을 기존 `Battle` 생성자(`double = false` 기본 파라미터)에 그대로 전달.
- **Network protocol**: `TURN_READY`의 `commands` 필드가 이미 `{ [BattlerIndex]: TurnCommandDto }` 형태(§6.2)이므로 더블에서 키가 2개(`PLAYER`/`PLAYER_2` 또는 `ENEMY`/`ENEMY_2`) 늘어나는 것 외에 스키마 변경이 없음.
- **팀 구성 UI**: 싱글 MVP의 "1마리 선택"을 "2마리 선택 + 필드 순서 지정"으로 확장하는 정도이며, `SUBMIT_TEAM`의 `pokemon` 배열 길이만 늘어남.
- **남는 진짜 작업**: 더블 특유의 상호작용(아군 대상 기술 기본 타겟, `AbilityId.COMMANDER`, 동료 스킵 로직 — 3장에서 확인한 `CommandPhase.handleFieldIndexLogic`/`checkCommander`)은 **이미 PvE 코드에 존재하므로 PvP 전용으로 새로 짤 필요가 없고**, `RemoteCommandWaitPhase`가 이 기존 로직과 자연스럽게 맞물리는지 통합테스트로 검증하는 작업만 남는다.

---

## 12. 보안 / 치팅 방지

| 위협 | 현재 코드의 취약점 | 대응 |
|---|---|---|
| 클라이언트가 임의로 HP 변경 | 없음(원래 신뢰 경계가 없는 싱글플레이어 게임) | §7.3 매 턴 해시 대조로 "조작된 값이 상대에게 전파"되는 것은 즉시 탐지. 완전한 차단(다른 클라이언트가 **처음부터** 그 값을 계산하지 않게 하는 것)은 5.1의 "서버가 엔진을 직접 실행"이 필요하며, MVP에서는 **탐지 후 몰수패/매치 무효화**로 대응(예방이 아닌 사후 차단) |
| 데미지 결과 조작 | 동일 | 동일(해시 대조). 추가로 서버가 "이번 턴 총 데미지가 이론적 최대치를 초과하는지"같은 러프한 상한선 검증을 곁들일 수 있음(선택 사항) |
| RNG 조작 | `Battle.battleSeed`를 클라이언트가 자체 생성하던 기존 구조 | §8.2에서 서버 발급으로 전환 — 이제 클라이언트는 시드 자체를 선택할 수 없음. 다만 시드를 받은 뒤 "내부적으로 다른 값을 쓰는" 조작은 여전히 해시 대조로만 탐지 가능 |
| 상대의 숨겨진 정보 조회(파티 구성 등) | 없음 | §5.3/§7.1: 서버가 클라이언트별로 "공개 범위가 다른" 페이로드를 내려줌(상대의 필드 밖 파티는 아예 전송하지 않음). 클라이언트 메모리를 직접 디버거로 들여다보는 것까지는 방지 불가(클라이언트 자체의 근본적 한계이며 이 게임만의 문제가 아님) — MVP 범위 밖으로 명시 |
| 명령 위조(다른 슬롯인 척) | 없음 | 서버가 `SELECT_MOVE` 등 모든 명령 메시지에 소켓 세션 ↔ `roomId` ↔ `BattlerIndex` 매핑을 강제(자신의 슬롯이 아닌 명령은 거부) |
| 오래된 명령 재전송(리플레이 공격) | 없음 | 모든 명령 메시지에 `turn` 필드 포함(§6.2에 이미 반영) → 서버가 현재 진행 중인 turn과 다르면 거부. 추가로 단조 증가하는 `nonce`/타임스탬프 권장 |
| 패킷 변조 | 없음(현재 REST도 HTTPS만 의존) | WebSocket도 WSS(TLS) 강제 + 서버 쪽 스키마 검증(타입/범위) — `PokerogueApi`가 이미 `PKR-Client-Version` 헤더로 클라이언트 버전을 검사하는 패턴이 있으므로 동일하게 재사용 가능 |
| 명령 타이밍 공격(상대 명령 먼저 보고 대응) | 해당 없음(싱글플레이어) | §5.2의 "양쪽 명령 모두 도착 후 동시 공개" 원칙으로 원천 차단 |
| 연결 끊김을 이용한 시간 끌기/명령 회피 | 해당 없음 | `DISCONNECT` 유예 타이머 + 유예 초과 시 자동 몰수패(§6.2, §10 단계 9) |

**요약**: MVP 수준에서 확보 가능한 것은 "**클라이언트 A가 조작된 결과를 클라이언트 B에게 강요하지 못하게 막는 것**"(해시 대조 + 명령 검증)이며, "클라이언트 A가 자기 자신의 화면에서 100% 정직하게 계산하도록 강제하는 것"(완전한 서버 authoritative 시뮬레이션)은 5.1에서 설명한 엔진-렌더링 결합 문제 때문에 이번 범위에서는 달성하지 못한다. 이는 반드시 설계 문서에 리스크로 명시해야 하는 트레이드오프다(13장에서 다시 정리).

---

## 13. 예상되는 기술적 위험과 해결 방법

| 위험 | 영향 | 완화 방안 |
|---|---|---|
| **엔진-렌더링 결합으로 인한 "진짜" 서버 시뮬레이션 불가**(§5.1) | 정교한 클라이언트 조작(자기 계산 자체를 속임)까지는 못 막음 | MVP는 해시 대조 기반 탐지로 진행하고, 장기 로드맵으로 "Move/Ability/데미지 계산 코어를 `Phaser.Scene`/렌더링 의존성에서 분리하는 리팩터"를 별도 과제로 추적(예: `globalScene`을 인터페이스로 추상화해 서버에서는 no-op 렌더러를 주입하는 어댑터부터 시작 — 대규모 작업이므로 이번 PR 범위 아님) |
| `globalScene` 전역 싱글턴이 "배틀 인스턴스 1개"를 전제 | 서버가 여러 매치를 동시에 시뮬레이션해야 하는 시나리오(§5.1 옵션 A)에서는 그대로 재사용 불가 | 이번 설계는 **클라이언트가 각자 로컬 `globalScene`으로 시뮬레이션**하고 서버는 시뮬레이션을 하지 않으므로(§5.2) 이 위험은 회피됨. 다만 향후 서버 시뮬레이션 전환 시 반드시 재검토 필요 |
| `Battle.turn` 진행이 두 클라이언트에서 완전히 동시에 시작하지 않을 수 있음(네트워크 지연) | 한쪽이 먼저 `TurnStartPhase`를 시작해버리면 §7.3 해시 시점이 어긋남 | `TURN_READY` 수신을 "이번 턴 시작 트리거"로 강제(§9.3) — 로컬에서 자체적으로 턴을 진행시키는 코드 경로가 없도록 `RemoteCommandWaitPhase`가 항상 게이트 역할 |
| 재접속 시 상태 재구성 | `PokemonSummonData`/`Arena` 등 다층 상태를 처음부터 다시 계산하기 어려움 | 서버가 `TURN_READY` 로그(턴별 명령 이력)를 전량 보관하고 있으므로, 재접속 클라이언트는 **매치 시작부터 현재 턴까지의 명령 로그를 재생**해 로컬 상태를 복원(기존 엔진이 결정론적이므로 "리플레이"가 곧 "정확한 현재 상태 재현"과 동일) — 별도의 스냅샷 직렬화 포맷을 새로 설계할 필요가 줄어듦 |
| `BattleType.PVP` 추가가 기존 `switch(battleType)` 분기 전체(다수 파일)에 누락 케이스를 만들 위험 | 컴파일은 되지만 런타임에 PvE 전용 동작이 PvP에서 실수로 실행될 수 있음(예: 포켓볼 허용, 몬스터 보상 지급) | enum 추가 후 `grep -rn "BattleType\." src`로 전체 사용처를 감사해 PvP에서 의미가 없는 분기(포획/도주/보상/BGM 등)를 명시적으로 처리하는 체크리스트를 PR 설명에 포함(9.2에서 이미 핵심 분기 나열) |
| 더블 확장 시 `RemoteCommandWaitPhase`가 두 원격 명령의 "부분 도착"(한쪽만 옴)을 잘못 처리 | 턴이 영원히 대기하거나 잘못된 순서로 진행 | §10 MVP에서 싱글로 이 로직을 충분히 검증한 뒤, §11에서 `Battle.getBattlerCount()` 기반으로 일반화하고 더블 전용 통합테스트(`test/tests/battle/` 기존 더블 테스트 패턴 참고)를 추가 |
| 결정론 깨짐(부동소수점/브라우저 간 `Phaser.Math.RND` 구현 차이) | 이론적으로 클라이언트 간 미세한 계산 차이가 발생하면 해시가 계속 불일치 | `Phaser.Math.RND`는 정수 시드 기반 의사난수 생성기(부동소수점 하드웨어 차이에 영향받지 않는 순수 산술)이므로 위험은 낮음. 다만 데미지 계산에 `Math.floor`/반올림이 일관되게 쓰이는지(모든 클라이언트가 동일 JS 엔진 사양을 따르므로 실질적으로 문제 없음) MVP 통합테스트 단계에서 실제로 두 브라우저 인스턴스로 동일 시드 재생 테스트를 해볼 것을 권장 |
| PvE 회귀(기존 싱글플레이 깨짐) | 이번 기능의 최우선 금지사항 | 9.2의 모든 변경을 "신규 파일 추가" 또는 "기존 switch/if에 새 case만 추가"로 한정, 기존 `Battle`/`BattleScene`/`BattleEndPhase` 핵심 파일은 가능한 한 서브클래스/신규 Phase로 우회(9.1). 기존 `test/tests/battle/*.test.ts`, `test/tests/moves/*`, 더블 배틀 테스트 스위트가 전부 그대로 통과하는지가 PvP PR의 머지 조건이 되어야 함 |

---

## 부록: 이번 조사에서 확인한, 설계에 영향을 준 핵심 코드 위치 인덱스

- 진입점/전역 싱글턴: `src/main.ts`, `src/globals/global-scene.ts`
- 씬/필드 조회: `src/battle-scene.ts:731`(`getPlayerField`), `:758`(`getEnemyField`), `:776`(`getField`), `:1257`(`newBattle`), `:2010`(`resetSeed`), `:2017`(`executeWithSeedOffset`)
- 배틀 상태: `src/battle.ts`(`Battle`, `TurnCommand`, `TurnCommands`, `randSeedInt`)
- Phase 시스템: `src/phase.ts`, `src/phase-manager.ts`, `src/phase-tree.ts`, `docs/phases.md`
- 턴 흐름: `src/phases/turn-init-phase.ts`, `src/phases/command-phase.ts`, `src/phases/enemy-command-phase.ts`, `src/phases/select-target-phase.ts`, `src/phases/turn-start-phase.ts`, `src/utils/speed-order-generator.ts`, `src/phases/move-phase.ts`, `src/phases/move-effect-phase.ts`, `src/phases/faint-phase.ts`, `src/phases/switch-phase.ts`, `src/phases/turn-end-phase.ts`, `src/phases/battle-end-phase.ts`
- 필드/포지션: `src/enums/battler-index.ts`, `src/enums/command.ts`, `src/enums/battle-type.ts`, `src/field/pokemon.ts`(`isPlayer`, `getBattlerIndex`, `getFieldIndex`, `getAlly`, `randBattleSeedInt`)
- 포켓몬 상태 계층: `src/data/pokemon/pokemon-data.ts`(`PokemonSummonData`, `PokemonTempSummonData`, `PokemonBattleData`, `PokemonWaveData`, `PokemonTurnData`)
- 필드 전역 상태: `src/field/arena.ts`
- 게임 모드/웨이브 진행: `src/game-mode.ts`, `src/enums/game-modes.ts`
- RNG: `src/utils/common.ts`, `src/battle.ts:493`
- 기존 서버 통신(REST): `src/api/api-base.ts`, `src/api/api.ts`, `src/api/account-api.ts`, `src/api/daily-api.ts`, `src/account.ts`
- 테스트 하네스: `test/framework/game-manager.ts`, `test/helpers/classic-mode-helper.ts`, `test/helpers/move-helper.ts`
