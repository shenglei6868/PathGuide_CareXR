import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {SurfaceDetection} from "../Surface Detection/Scripts/SurfaceDetection"
import {PathData} from "./BuiltPathData"
import {LineController} from "./LineController"
import {BuildingPathState} from "./PathMakerStates/BuildingPathState"
import {IdleState} from "./PathMakerStates/IdleState"
import {IPathMakerState} from "./PathMakerStates/IPathMakerState"
import {PlacingFinishState} from "./PathMakerStates/PlacingFinishState"
import {PlacingStartState} from "./PathMakerStates/PlacingStartState"
import {PathmakingPlayerFeedback} from "./PathmakingPlayerFeedback"
import {PlayerPaceCalculator} from "./PlayerPaceCalculator"
import {UI} from "./UI"

@component
export class PathMaker extends BaseScriptComponent {
  @input
  pathRmv: RenderMeshVisual

  @input
  pfbSurfaceDetection: ObjectPrefab

  @input
  pfbLine: ObjectPrefab

  @input
  @allowUndefined
  camObj: SceneObject

  @input
  camObjOffset: SceneObject

  @input
  pathDistText: Text

  @input
  finalPathDistText: Text

  @input
  playerPaceCalculator: PlayerPaceCalculator

  @input
  pathmakingPlayerFeedback: PathmakingPlayerFeedback

  @input
  protected readonly ui: UI

  @input
  protected readonly placingStartFinishLinesForwardDisplace: number = 200

  private camTr: Transform = null
  private camOffsetTr: Transform = null
  private currentState: IPathMakerState = new IdleState()

  protected bigMoveDistanceThreshold = 40
  protected hermiteResolution = 12
  protected resampleResoluton = 4

  private surfaceDetection: SurfaceDetection | undefined

  get pathMade(): PublicApi<PathData> {
    return this.pathMadeEvent.publicApi()
  }

  protected pathMadeEvent: Event<PathData> = new Event<PathData>()

  public init() {
    this.camTr = this.camObj.getTransform()
    this.camOffsetTr = this.camObjOffset.getTransform()
  }

  public start() {
    this.startStartPlacementState()

    this.ui.resetPathClicked.add(() => {
      // reset path
      if (this.surfaceDetection) {
        this.surfaceDetection.reset()
      }
      this.startStartPlacementState()
    })
  }

  public stop() {
    if (this.currentState) {
      this.currentState.stop()
    }
    this.currentState = new IdleState()
  }

  private startStartPlacementState() {
    this.currentState.stop()
    if (!this.surfaceDetection) {
      this.surfaceDetection = this.pfbSurfaceDetection
        .instantiate(null)
        .getChild(0)
        .getComponent("ScriptComponent") as SurfaceDetection
    }
    this.currentState = new PlacingStartState(
      this,
      this.surfaceDetection,
      this.pfbLine,
      this.camTr,
      this.placingStartFinishLinesForwardDisplace,
      (startPosition, startRotation, startObject) => {
        this.startBuildingPathState(startPosition, startRotation, startObject)
      }
    )
    this.currentState.start()
  }

  private startBuildingPathState(startPosition: vec3, startRotation: quat, startObject: SceneObject) {
    this.currentState.stop()
    this.currentState = new BuildingPathState(
      this,
      this.camTr,
      this.camOffsetTr,
      this.pathRmv,
      this.pathDistText,
      startPosition,
      startRotation,
      startObject,
      this.ui,
      this.playerPaceCalculator,
      this.pathmakingPlayerFeedback,
      this.bigMoveDistanceThreshold,
      this.hermiteResolution,
      this.resampleResoluton,
      (startPosition, startRotation, startObject, pathPoints, lastVisualPoints) => {
        this.startFinishPlacementState(startObject, startPosition, startRotation, pathPoints, lastVisualPoints)
      },
      (startPosition, startRotation, startObject, splinePoints) => {
        // NOTE: Use this line anywhere you want a stack trace
        // print(`${new Error().stack}`);
        this.finishLoop(startObject, startPosition, startRotation, splinePoints)
      }
    )
    this.currentState.start()
  }

  private startFinishPlacementState(
    startObject: SceneObject,
    startPosition: vec3,
    startRotation: quat,
    pathPoints: vec3[],
    lastVisualPoints: vec3[]
  ) {
    this.currentState.stop()
    this.currentState = new PlacingFinishState(
      startObject,
      this,
      this.surfaceDetection,
      this.pfbLine,
      this.camTr,
      this.placingStartFinishLinesForwardDisplace,
      pathPoints,
      lastVisualPoints,
      this.pathRmv,
      this.bigMoveDistanceThreshold,
      this.hermiteResolution,
      this.resampleResoluton,

      (finishPosition, finishRotation, finishObject, splinePoints: {position: vec3; rotation: quat}[]) => {
        const finishCtrl = finishObject.getComponent(LineController.getTypeName())
        finishCtrl.setRealVisual()
        this.finishSprint(
          startObject,
          startPosition,
          startRotation,
          finishObject,
          finishPosition,
          finishRotation,
          splinePoints
        )
      }
    )
    this.currentState.start()
  }


  private savePathData(data: any) {
    if (!global.persistentStorageSystem) return
    const store = global.persistentStorageSystem.store
    const historyJson = store.getString("PathHistory")
    let history: any[] = []
    if (historyJson) {
      try {
        history = JSON.parse(historyJson)
      } catch (e) {
        history = []
      }
    }

    const serializeVec3 = (v: vec3) => (v ? {x: v.x, y: v.y, z: v.z} : null)
    const serializeQuat = (q: quat) => (q ? {w: q.w, x: q.x, y: q.y, z: q.z} : null)
    const serializedData = {
      isLoop: data.isLoop,
      startPosition: serializeVec3(data.startPosition),
      startRotation: serializeQuat(data.startRotation),
      finishPosition: serializeVec3(data.finishPosition),
      finishRotation: serializeQuat(data.finishRotation),
      splinePoints: (data.splinePoints || []).map((p: any) => ({
        position: serializeVec3(p.position),
        rotation: serializeQuat(p.rotation)
      }))
    }

    history.push(serializedData)
    store.putString("PathHistory", JSON.stringify(history))
  }

  protected finishLoop(
    startObject: SceneObject,
    startPosition: vec3,
    startRotation: quat,
    splinePoints: {position: vec3; rotation}[]
  ) {
    this.currentState.stop()
    this.currentState = new IdleState()
    this.currentState.start()
    const pathData = {
      isLoop: true,
      startObject,
      startPosition,
      startRotation,
      splinePoints
    }
    this.savePathData(pathData)
    this.pathMadeEvent.invoke(pathData as any)
  }

  private finishSprint(
    startObject: SceneObject,
    startPosition: vec3,
    startRotation: quat,
    finishObject: SceneObject,
    finishPosition: vec3,
    finishRotation: quat,
    splinePoints: {position: vec3; rotation}[]
  ) {
    this.currentState.stop()
    this.currentState = new IdleState()
    this.currentState.start()
    const pathData = {
      isLoop: false,
      startObject,
      finishObject,
      startPosition,
      startRotation,
      finishPosition,
      finishRotation,
      splinePoints
    }
    this.savePathData(pathData)
    this.pathMadeEvent.invoke(pathData as any)
  }
}
