from gymnasium.envs.registration import register

# Sin max_episode_steps: el propio entorno termina la época al agotar sus 50 pasos.
register(
    id="RocketLanding3D-v0",
    entry_point="rocket_env.rocket_landing:RocketLanding3DEnv",
)
