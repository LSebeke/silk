# Glossary

**Story**: A planned adventure or campaign laid out on a canvas as Story Elements and Connections.

**Story Element**: A single node in a Story (a person, place, thing, event…). Every Story Element has exactly one Element Class.

**Element Class**: The fixed kind of a Story Element. Each Element Class maps to one FoundryVTT document type (Actor, Item, Scene, Journal Entry). Some classes map to a Journal Entry with a predefined layout.

**Connection**: A link between two Story Elements, created manually or implicitly when a Story Element is created from an existing one.

**GM**: The game master; the primary user, who plans the Story and runs sessions from it.

**Play Session**: One real-world sitting where the Story is played. Its outcomes change the World State.

**World State**: The current truth of the campaign as changed by Play Sessions (who is dead, what is looted, what was revealed). Must flow back into the Story without manual transcription.

**Game System**: The rules system a Foundry world runs (v1: DSA5 / Das Schwarze Auge 5). Determines the shape of Actors and Items.

**Campaign**: A long-running game with one group, made up of a sequence of Adventures.

**Canon**: The authoritative body of Story Elements and Connections for one Campaign, independent of any Foundry world. A Canon can be branched to seed a new Campaign.

**Adventure**: A branch of the Canon that a group plays through. Play changes the Adventure's World State; when the Adventure ends, those changes are merged back into the Canon (git-style).

**World Canvas**: The canvas belonging to one Foundry world, where the GM lays out and works on that world's Story.

**Behavioural Connection**: A Connection whose type drives Foundry behaviour (e.g. "located in", "owns"). All other Connections are free-form, with a label.

**Reveal**: The GM sharing a Story Element, or a single piece of information attached to it, with the players.

**Info Block**: A named piece of information inside a Story Element's body. Each Info Block can be Revealed on its own.

**Materialize**: Create the Foundry document that represents a Story Element. Whether this happens immediately or on demand is a GM setting.

**Focus View**: A canvas mode that shows only the Story Elements within a few Connections of a focus (the active Foundry Scene and the actors in it, or an element the GM picks), and hides or dims the rest.
