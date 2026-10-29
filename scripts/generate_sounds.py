import math
from array import array
from pathlib import Path

import lameenc

out_dir = Path(r"C:\Users\Admin\Desktop\ClassSound\client\public\sounds")
out_dir.mkdir(parents=True, exist_ok=True)

sample_rate = 44100

def tone(freq, duration, volume=0.6):
    samples = []
    total = int(sample_rate * duration)
    for i in range(total):
        t = i / sample_rate
        value = math.sin(2 * math.pi * freq * t)
        samples.append(int(max(-1.0, min(1.0, value * volume)) * 32767))
    return samples


def noise_pulse(duration, volume=0.35, freq=1800):
    samples = []
    total = int(sample_rate * duration)
    for i in range(total):
        t = i / sample_rate
        env = max(0.0, 1.0 - (t / duration))
        noise = ((i * 7919) % 65536) / 32768.0 - 1.0
        carrier = math.sin(2 * math.pi * freq * t)
        value = (noise * 0.8 + carrier * 0.2) * volume * env
        samples.append(int(max(-1.0, min(1.0, value)) * 32767))
    return samples


def save_mp3(path: Path, samples):
    pcm = array('h', samples).tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(sample_rate)
    enc.set_channels(1)
    enc.set_quality(2)
    mp3 = enc.encode(pcm) + enc.flush()
    path.write_bytes(mp3)


sound_defs = {
    'pet': [
        *tone(440, 0.12, 0.35),
        *tone(660, 0.10, 0.45),
        *tone(880, 0.16, 0.5),
    ],
    'wow': [
        *tone(150, 0.18, 0.5),
        *tone(90, 0.28, 0.45),
        *tone(230, 0.35, 0.4),
        *noise_pulse(0.20, 0.35, 1800),
    ],
    'fail': [
        *tone(200, 0.14, 0.5),
        *tone(120, 0.20, 0.5),
        *tone(80, 0.26, 0.45),
    ],
    'amongus': [
        *noise_pulse(0.10, 0.25, 600),
        *tone(500, 0.08, 0.35),
        *tone(350, 0.08, 0.35),
        *tone(220, 0.12, 0.4),
    ],
    'shield': [
        *tone(800, 0.08, 0.4),
        *tone(1100, 0.08, 0.4),
        *tone(1400, 0.12, 0.35),
    ],
    'meme': [
        *tone(440, 0.08, 0.4),
        *tone(660, 0.08, 0.5),
        *tone(440, 0.08, 0.45),
        *tone(660, 0.08, 0.5),
        *tone(880, 0.14, 0.45),
    ],
    'michael': [
        *tone(330, 0.12, 0.35),
        *tone(330, 0.12, 0.35),
        *tone(392, 0.14, 0.38),
        *tone(440, 0.18, 0.4),
    ],
    'slap': [
        *noise_pulse(0.12, 0.6, 3500),
        *tone(70, 0.08, 0.4),
        *tone(50, 0.08, 0.3),
    ],
}

for name, samples in sound_defs.items():
    save_mp3(out_dir / f"{name}.mp3", samples)
    print(f"created {name}.mp3")
