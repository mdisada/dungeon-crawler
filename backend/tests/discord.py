import discord
from discord.ext import commands
import logging
from datetime import datetime
from dotenv import load_dotenv
import os

load_dotenv()

token = os.getenv('DISCORD_TOKEN')
guild_id = os.getenv('DISCORD_GUILD_ID')
debug_guilds = [int(guild_id)] if guild_id else None

RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'recordings')

handler = logging.FileHandler(filename='discord.log', encoding='utf-8', mode='w')
logging.getLogger('discord').setLevel(logging.DEBUG)
logging.getLogger('discord').addHandler(handler)

intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True

bot = commands.Bot(command_prefix='/', intents=intents, debug_guilds=debug_guilds)

connections = {}

@bot.event
async def on_ready():
    print(f"We are ready to go in, {bot.user.name}")
    for guild in bot.guilds:
        print(f"  connected to guild: {guild.name} (id: {guild.id})")

@bot.slash_command(description="Join your voice channel and start recording audio")
async def listen(ctx: discord.ApplicationContext):
    voice = ctx.author.voice
    if voice is None:
        await ctx.respond("You need to be in a voice channel to use this command.")
        return

    vc = await voice.channel.connect()
    connections[ctx.guild.id] = vc

    vc.start_recording(discord.sinks.WaveSink(), recording_finished, ctx.channel)
    await ctx.respond("Started recording! Use /stop_listening to stop and save the audio.")

async def recording_finished(sink: discord.sinks.Sink, channel: discord.TextChannel, *args):
    await sink.vc.disconnect()

    if not sink.audio_data:
        await channel.send("Finished recording, but no audio was captured.")
        return

    session_dir = os.path.join(RECORDINGS_DIR, datetime.now().strftime('%Y%m%d_%H%M%S'))
    os.makedirs(session_dir, exist_ok=True)

    recorded_users = []
    for user_id, audio in sink.audio_data.items():
        path = os.path.join(session_dir, f"{user_id}.{sink.encoding}")
        with open(path, 'wb') as f:
            f.write(audio.file.read())

        recorded_users.append(f"<@{user_id}>")

    await channel.send(f"Finished recording for: {', '.join(recorded_users)}\nSaved to `{session_dir}`")

@bot.slash_command(description="Stop recording and save the audio")
async def stop_listening(ctx: discord.ApplicationContext):
    vc = connections.get(ctx.guild.id)
    if vc is None:
        await ctx.respond("Not currently recording in this server.")
        return

    vc.stop_recording()
    del connections[ctx.guild.id]
    await ctx.respond("Stopping recording...")

bot.run(token)

