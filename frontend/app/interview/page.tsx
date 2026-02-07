'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useFBX, useAnimations, Environment } from '@react-three/drei';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Group, SkinnedMesh, MathUtils, Object3D, Vector3, Bone } from 'three';
import { useInterviewWebRTC } from '@/lib/useInterviewWebRTC';
import { useLocalRecording } from '@/lib/useLocalRecording';
import { useStreamingPlayback } from '@/lib/useStreamingPlayback';

const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
const modelUrl = '/avatar-6GOM4mCjrgfPFNuDGSQs.glb';

// -----------------------------------------------------------------------------
// Positioning – tune these for how the character appears in the camera frame.
// -----------------------------------------------------------------------------
const AVATAR_POSITION_X = 0;
const AVATAR_POSITION_Y = 0;
const AVATAR_POSITION_Z = -1.75;
const CAMERA_OFFSET_X = 0;
const CAMERA_OFFSET_Y = 0.05;
const CAMERA_OFFSET_Z = 2.2;
const HIDE_MESH_NAMES = ['Bottom', 'Footwear', 'Hand'];
const ARM_REST_ROTATION_LEFT = [0.6, 0, 0];
const ARM_REST_ROTATION_RIGHT = [0.6, 0, 0];
// -----------------------------------------------------------------------------

export default function Interview() {
    const [isSpeaking, setIsSpeaking] = useState(false);

    const { state: webrtcState, connect, disconnect, resetStreamed, setMicEnabled } = useInterviewWebRTC();
    const { startRecording, stopRecording, getDownloadUrl, recordedChunks, isRecording } = useLocalRecording();

    const onStreamingEnd = useCallback(() => {
        setMicEnabled(true);
        resetStreamed();
    }, [setMicEnabled, resetStreamed]);

    // Mute mic while backend is sending/playing response so VAD doesn't hear playback or echo
    useEffect(() => {
        if (webrtcState.status !== 'connected') return;
        if (webrtcState.streamedAudioChunks.length > 0) {
            setMicEnabled(false);
        }
    }, [webrtcState.status, webrtcState.streamedAudioChunks.length, setMicEnabled]);

    const {
        isStreaming,
        streamingTimeRef,
        streamingDurationRef,
    } = useStreamingPlayback(
        webrtcState.streamedAudioChunks,
        webrtcState.streamEnded,
        onStreamingEnd
    );

    const handleStart = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('[Interview] User audio stream obtained');
            startRecording(stream);
            await connect(stream);
            console.log('[Interview] WebRTC connected; streaming user audio to backend');
        } catch (err) {
            console.error('[Interview] Start failed', err);
        }
    }, [connect, startRecording]);

    const handleDisconnect = useCallback(() => {
        stopRecording();
        disconnect();
    }, [stopRecording, disconnect]);

    const handleDownload = useCallback(() => {
        const url = getDownloadUrl();
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        a.download = `interview-recording-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }, [getDownloadUrl]);

    return (
        <div id='canvas-container' style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }}>
            <Canvas gl={{ antialias: true, alpha: false }} style={{ width: '100%', height: '100%' }}>
                <ambientLight intensity={0.4} />
                <directionalLight position={[2, 5, 5]} intensity={1.2} castShadow />
                <Environment preset="studio" />
                <Avatar
                    audioData=""
                    speechMarksData={webrtcState.streamedSpeechMarks}
                    setIsSpeaking={setIsSpeaking}
                    onSpeechEnd={() => {}}
                    isStreaming={isStreaming}
                    streamingTimeRef={streamingTimeRef}
                    streamingDurationRef={streamingDurationRef}
                />
            </Canvas>
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 12, alignItems: 'center', zIndex: 10 }}>
                <button
                    type="button"
                    onClick={handleStart}
                    disabled={webrtcState.status === 'connecting' || webrtcState.status === 'connected'}
                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', cursor: 'pointer' }}
                >
                    {webrtcState.status === 'connecting' ? 'Connecting…' : webrtcState.status === 'connected' ? 'Connected' : 'Start interview'}
                </button>
                <button
                    type="button"
                    onClick={handleDisconnect}
                    disabled={webrtcState.status !== 'connected' && webrtcState.status !== 'connecting'}
                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #333', background: '#333', color: '#fff', cursor: 'pointer' }}
                >
                    Disconnect
                </button>
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={recordedChunks.length === 0}
                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #333', background: '#111', color: '#fff', cursor: 'pointer' }}
                >
                    Download recording
                </button>
                <span style={{ color: '#aaa', fontSize: 14 }}>
                    {webrtcState.status === 'error' && webrtcState.error}
                    {isRecording && ' Recording…'}
                </span>
            </div>
        </div>
    );
}

// Polly neural viseme codes -> avatar morph targets (matches AWS Polly viseme list)
const corresponding: Record<string, string> = {
    'p': 'viseme_PP',
    't': 'viseme_DD',
    'S': 'viseme_SH',
    'i': 'viseme_IH',
    'u': 'viseme_UH',
    'a': 'viseme_AA',
    '@': 'viseme_AE',
    'e': 'viseme_EH',
    'E': 'viseme_EY',
    'o': 'viseme_OW',
    // Additional Polly visemes for better lip-sync
    'k': 'viseme_DD',
    'f': 'viseme_PP',
    's': 'viseme_SH',
    'dZ': 'viseme_SH',
    'tS': 'viseme_SH',
    'd': 'viseme_DD',
    'b': 'viseme_PP',
};

const VISEME_TEST_ENABLED = false;  // Set true to run looping viseme test sequence.
const VISEME_TEST_SEQUENCE = ['a', 'i', 'u', 'e', 'o', 'p', 't', 'S'];
const VISEME_STEP_DURATION = 0.4;

function findMeshByName(root: Object3D, pattern: RegExp, exclude?: RegExp): SkinnedMesh | null {
    let found: SkinnedMesh | null = null;
    root.traverse((obj) => {
        if (found) return;
        if (obj instanceof SkinnedMesh && obj.geometry && obj.name.match(pattern)) {
            if (!exclude || !obj.name.match(exclude)) found = obj;
        }
    });
    return found;
}

function Avatar(
    {
        audioData,
        speechMarksData,
        setIsSpeaking,
        onSpeechEnd,
        isStreaming = false,
        streamingTimeRef,
        streamingDurationRef,
    }: {
        audioData: string;
        speechMarksData: { time: number; value: string }[];
        setIsSpeaking: (v: boolean) => void;
        onSpeechEnd: () => void;
        isStreaming?: boolean;
        streamingTimeRef?: React.RefObject<number>;
        streamingDurationRef?: React.RefObject<number>;
    }
) {

    const headFollow = true;
    const smoothMorphTarget = true;
    const morphTargetSmoothing = 0.5;

    const { scene } = useGLTF(modelUrl);
    const clonedScene = useMemo(() => (scene ? scene.clone() : null), [scene]);

    const headMesh = useMemo(() => clonedScene ? findMeshByName(clonedScene, /head/i, /teeth/i) : null, [clonedScene]);
    const teethMesh = useMemo(() => clonedScene ? findMeshByName(clonedScene, /teeth/i) : null, [clonedScene]);

    const idleAnimation = useFBX(`${baseUrl}/idle.fbx`);
    idleAnimation.animations[0].name = 'idle';

    const group = useRef<Group>(null);
    const sceneRef = useRef<Object3D | null>(null);
    const { actions } = useAnimations([idleAnimation.animations[0]], sceneRef);
    const headWorldPos = useRef(new Vector3());
    const lookAtTarget = useRef(new Vector3());
    const cameraOffset = useMemo(
        () => new Vector3(CAMERA_OFFSET_X, CAMERA_OFFSET_Y, CAMERA_OFFSET_Z),
        []
    );

    const [animation, setAnimation] = useState<string>('idle');
    const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

    const headMorphNames = useMemo(() => {
        const dict = headMesh?.morphTargetDictionary;
        return dict ? Object.keys(dict) : [];
    }, [headMesh]);

    useEffect(() => {
        if (sceneRef && clonedScene) sceneRef.current = clonedScene;
        return () => { if (sceneRef) sceneRef.current = null; };
    }, [clonedScene]);

    useEffect(() => {
        if (!clonedScene) return;
        clonedScene.traverse((obj) => {
            if (obj instanceof SkinnedMesh && obj.name) {
                const hide = HIDE_MESH_NAMES.some((part) => obj.name.includes(part));
                if (hide) obj.visible = false;
            }
        });
    }, [clonedScene]);

    // Idle animation disabled for now.
    // useEffect(() => {
    //     actions?.idle?.play();
    //     return () => { actions?.idle?.stop(); };
    // }, [actions]);

    useEffect(() => {
        if (!headMesh || !teethMesh) return;
        const headDict = headMesh.morphTargetDictionary;
        const teethDict = teethMesh.morphTargetDictionary;
        const headNames = headDict ? Object.keys(headDict) : [];
        const teethNames = teethDict ? Object.keys(teethDict) : [];
        console.log('[Avatar] Head morph targets:', headNames.length ? headNames : '(none)');
        console.log('[Avatar] Teeth morph targets:', teethNames.length ? teethNames : '(none)');
    }, [headMesh, teethMesh]);

    // Batch mode: single base64 audio + speech marks
    useEffect(() => {
        if (isStreaming || !audioData || !speechMarksData?.length) return;
        console.log('[Avatar] Playback layer: received audioData (base64 length)', audioData.length, 'speechMarks', speechMarksData.length);
        const newAudio = new Audio(`data:audio/mp3;base64,${audioData}`);
        setAudio(newAudio);
        if (setIsSpeaking) setIsSpeaking(true);
        newAudio.play().catch((error) => {
            console.error('Error playing audio:', error);
            alert('Failed to play audio. Please try again.');
        });
        const handleAudioEnded = () => {
            setAnimation('Idle');
            if (setIsSpeaking) setIsSpeaking(false);
            if (onSpeechEnd) onSpeechEnd();
        };
        newAudio.addEventListener('ended', handleAudioEnded);
        setAnimation('Idle');
        return () => {
            newAudio.removeEventListener('ended', handleAudioEnded);
        };
    }, [audioData, speechMarksData, setIsSpeaking, onSpeechEnd, isStreaming]);

    // Streaming mode: reflect speaking state
    useEffect(() => {
        if (isStreaming && setIsSpeaking) setIsSpeaking(true);
    }, [isStreaming, setIsSpeaking]);

    useFrame((state) => {
        if (!clonedScene) return;
        let headBone: Object3D | undefined;
        clonedScene.traverse((obj) => {
            if (obj instanceof Bone) {
                if (obj.name === 'LeftShoulder' || obj.name === 'LeftArm') {
                    obj.rotation.set(ARM_REST_ROTATION_LEFT[0], ARM_REST_ROTATION_LEFT[1], ARM_REST_ROTATION_LEFT[2]);
                }
                if (obj.name === 'RightShoulder' || obj.name === 'RightArm') {
                    obj.rotation.set(ARM_REST_ROTATION_RIGHT[0], ARM_REST_ROTATION_RIGHT[1], ARM_REST_ROTATION_RIGHT[2]);
                }
                if (!headBone && obj.name === 'Head') headBone = obj;
            }
        });
        if (headBone) {
            headBone.getWorldPosition(headWorldPos.current);
            state.camera.position.copy(headWorldPos.current).add(cameraOffset);
            lookAtTarget.current.set(
                headWorldPos.current.x,
                headWorldPos.current.y + cameraOffset.y,
                headWorldPos.current.z
            );
            state.camera.lookAt(lookAtTarget.current);
            if (headFollow) headBone.lookAt(state.camera.position);
        }
    });

    useFrame((state) => {
        const headDict = headMesh?.morphTargetDictionary;
        const teethDict = teethMesh?.morphTargetDictionary;
        if (!headMesh || !headDict) return;
        if (!headMesh.morphTargetInfluences) return;

        const applyViseme = (morphTargetName: string, influence: number) => {
            const headIndex = headDict[morphTargetName];
            if (headIndex !== undefined) {
                headMesh.morphTargetInfluences![headIndex] = smoothMorphTarget
                    ? MathUtils.lerp(headMesh.morphTargetInfluences![headIndex], influence, morphTargetSmoothing)
                    : influence;
            }
            if (teethDict && teethMesh?.morphTargetInfluences) {
                const teethIndex = teethDict[morphTargetName];
                if (teethIndex !== undefined) {
                    teethMesh.morphTargetInfluences[teethIndex] = smoothMorphTarget
                        ? MathUtils.lerp(teethMesh.morphTargetInfluences[teethIndex], influence, morphTargetSmoothing)
                        : influence;
                }
            }
        };

        const currentAudioTimeMs =
            isStreaming && streamingTimeRef?.current != null
                ? streamingTimeRef.current
                : audio
                    ? audio.currentTime * 1000
                    : null;
        const durationMs =
            isStreaming && streamingDurationRef?.current != null
                ? streamingDurationRef.current
                : audio
                    ? audio.duration * 1000
                    : 0;
        const isPaused =
            isStreaming
                ? currentAudioTimeMs != null && durationMs > 0 && currentAudioTimeMs >= durationMs
                : !!(audio && (audio.paused || audio.ended));

        if (currentAudioTimeMs != null && speechMarksData?.length) {
            if (isPaused) {
                setAnimation('Idle');
                Object.values(corresponding).forEach((name) => applyViseme(name, 0));
                return;
            }
            Object.values(corresponding).forEach((name) => applyViseme(name, 0));
            for (let i = 0; i < speechMarksData.length; i++) {
                const viseme = speechMarksData[i];
                const startTime = viseme.time;
                const endTime = speechMarksData[i + 1] ? speechMarksData[i + 1].time : durationMs;
                if (currentAudioTimeMs >= startTime && currentAudioTimeMs < endTime) {
                    const morphTargetName = corresponding[viseme.value];
                    if (morphTargetName) applyViseme(morphTargetName, 1);
                    break;
                }
            }
        } else if (VISEME_TEST_ENABLED && headMorphNames.length > 0) {
            const sequence = headMorphNames.some((n) => n.startsWith('viseme_'))
                ? Object.values(corresponding)
                : headMorphNames;
            const index = Math.floor(state.clock.elapsedTime / VISEME_STEP_DURATION) % sequence.length;
            const currentMorphName = sequence[index];
            sequence.forEach((name) => applyViseme(name, name === currentMorphName ? 1 : 0));
        }
    });

    if (!clonedScene) return null;

    return (
        <group ref={group} position={[AVATAR_POSITION_X, AVATAR_POSITION_Y, AVATAR_POSITION_Z]}>
            <primitive object={clonedScene} />
        </group>
    );
}

useGLTF.preload(modelUrl);
