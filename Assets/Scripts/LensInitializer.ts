import {LineController} from "./LineController"
import {SprintPathData} from "./BuiltPathData"
import {PathMaker} from "./PathMaker"
import {PathWalker} from "./PathWalker"
import {TutorialController} from "./TutorialController"
import {UI} from "./UI"

@component
export class LensInitializer extends BaseScriptComponent {
  @input
  ui: UI

  @input
  tutorialController: TutorialController

  @input
  pathMaker: PathMaker

  @input
  pathWalker: PathWalker

  @input
  camSo: SceneObject

  private camTr: Transform

  private floorOffsetFromCamera = -100

  private static instance: LensInitializer

  private floorIsSet: boolean = false

  private vec3up: vec3 = vec3.up()

  private constructor() {
    super()
  }

  public static getInstance(): LensInitializer {
    if (!LensInitializer.instance) {
      throw new Error("Trying to get LensInitializer instance, but it hasn't been set.  You need to call it later.")
    }
    return LensInitializer.instance
  }

  onAwake() {
    if (!LensInitializer.instance) {
      LensInitializer.instance = this
    } else {
      throw new Error("LensInitializer already has an instance but another one is initializing. Aborting.")
    }

    this.camTr = this.camSo.getTransform()

    this.pathMaker.init()
    this.pathWalker.init()

    this.ui.getSceneObject().enabled = true

    this.tutorialController.startTutorial(() => {
      this.startHomeState()
    })
  }

  setFloorOffsetFromCamera(floorPos: vec3) {
    // Get the difference between current cam height and this Y value
    // Meaning, we take the camera's height at floor set to be the player's "height" for this path
    const camPos = this.camTr.getWorldPosition()
    const offset = floorPos.sub(camPos)
    // Because player is looking down when height is taken,
    // offset is closer than it will be (when player is looking out)
    this.floorOffsetFromCamera = offset.y - 10
    this.floorIsSet = true
  }

  getPlayerGroundPos() {
    if (!this.floorIsSet) {
      throw Error("Floor not set. You need to call it later.")
    }
    return this.camTr.getWorldPosition().add(this.vec3up.uniformScale(this.floorOffsetFromCamera))
  }

    private startHomeState() {
    this.ui.showHomeUi()
    
    // 我们要确保每次回到主页面，之前绑定的事件都得清除，只留一份。
    let pathClickedRemover: () => void = null
    let loadClickedRemover: () => void = null
    
    const cleanupHooks = () => {
        if (pathClickedRemover) pathClickedRemover()
        if (loadClickedRemover) loadClickedRemover()
    }
    
    // --- 1. 点击 NEW PATH（新建）时的逻辑 ---
    pathClickedRemover = this.ui.createPathClicked.add(() => {
      cleanupHooks()
      this.pathMaker.start()
      
      const remover = this.pathMaker.pathMade.add((data: any) => {
        remover() // 新建完成后触发
        
        // 我们不直接走寻路了，而是回到主页面，因为我们要退出来！！
        // 清理掉还在场景中的起点和终点标志，避免它们在未加载时残留
        if (data.startObject && !isNull(data.startObject)) {
          data.startObject.destroy()
        }
        if (data.finishObject && !isNull(data.finishObject)) {
          data.finishObject.destroy()
        }

        this.startHomeState() 
      })
    })

    // --- 2. 点击 LOAD PATH (读取) 时的逻辑 ---
    loadClickedRemover = this.ui.loadPathClicked.add(() => {
        cleanupHooks()
        this.pathMaker.stop()
        
        if (!global.persistentStorageSystem) {
            print("No persistent storage system.")
            this.startHomeState()
            return
        }
        
        // 加这几行调试
        print("Load Path 被点击")
        print("persistentStorageSystem: " + (global.persistentStorageSystem ? "存在" : "不存在"))
    
        if (!global.persistentStorageSystem) {
            print("No persistent storage system.")
            this.startHomeState()
            return
        }
    
        const store = global.persistentStorageSystem.store
        print("store: " + (store ? "存在" : "不存在"))
    
        const historyJson = store.getString("PathHistory")
        print("historyJson: " + historyJson)
        
        if (!historyJson) {
            print("No history found")
            this.startHomeState()
            return
        }
        
        let history = []
        try {
            history = JSON.parse(historyJson)
        } catch(e) {
            this.startHomeState()
            return
        }
        
        if (history.length === 0) {
            this.startHomeState()
            return
        }
        
        // 拿到存下来的最后一套路线
        const data = history[history.length - 1] 
        
        const deserializeVec3 = (v: any) => v ? new vec3(v.x, v.y, v.z) : null
        const deserializeQuat = (q: any) => q ? new quat(q.w, q.x, q.y, q.z) : null

        const splinePoints = data.splinePoints.map((p: any) => ({
            position: deserializeVec3(p.position),
            rotation: deserializeQuat(p.rotation)
        }))
        
        // 因为存在本地的数据是纯数字，我们要恢复成 Transform 用于游戏行走
        const startPos = deserializeVec3(data.startPosition)
        const startRot = deserializeQuat(data.startRotation)
        
        const startObject = this.pathMaker.pfbLine.instantiate(this.getSceneObject())
        const startTr = startObject.getTransform()
        if(startPos) startTr.setWorldPosition(startPos)
        if(startRot) startTr.setWorldRotation(startRot)
        const startLineController: any = startObject.getComponent(LineController.getTypeName())
        if (startLineController) {
            startLineController.init(true)
            startLineController.setRealVisual()
        }

        if (!data.isLoop) {
            const finishPos = deserializeVec3(data.finishPosition)
            const finishRot = deserializeQuat(data.finishRotation)
            
            const finishObject = this.pathMaker.pfbLine.instantiate(this.getSceneObject())
            const finishTr = finishObject.getTransform()
            if(finishPos) finishTr.setWorldPosition(finishPos)
            if(finishRot) finishTr.setWorldRotation(finishRot)
            const finishLineController: any = finishObject.getComponent(LineController.getTypeName())
            if (finishLineController) {
                finishLineController.init(false)
                finishLineController.setRealVisual()
            }

            // 把恢复的物体塞给系统去游玩
            this.pathWalker.start(splinePoints, false, startTr, finishTr, () => {
                if (!isNull(startObject)) startObject.destroy()
                if (finishObject && !isNull(finishObject)) finishObject.destroy()
                this.startHomeState() // 走完了，回主页面
            }, true)
        } else {
            this.pathWalker.start(splinePoints, true, startTr, undefined, () => {
                if (!isNull(startObject)) startObject.destroy()
                this.startHomeState()
            }, true)
        }
    })
  }
}
