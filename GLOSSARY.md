# Glossary

**Story**: A planned adventure or campaign laid out on a canvas as Story Elements and Connections.

**Story Element**: A single node in a Story (a person, place, thing, event…). Every Story Element has exactly one Element Class.

**Element Class**: The fixed kind of a Story Element. Each Element Class maps to one FoundryVTT document type (Actor, Item, Scene, Journal Entry). Some classes map to a Journal Entry with a predefined layout.

**Connection**: A link between two Story Elements, created manually or implicitly when a Story Element is created from an existing one. A Connection is either directed (A loves B) or mutual (C and D are friends). Each Connection can be Revealed on its own.

**GM**: The game master; the primary user, who plans the Story and runs sessions from it.

**Play Session**: One real-world sitting where the Story is played. Its outcomes change the World State.

**World State**: The current truth of the campaign as changed by Play Sessions (who is dead, what is looted, what was revealed). Must flow back into the Story without manual transcription.

**Game System**: The rules system a Foundry world runs (v1: DSA5 / Das Schwarze Auge 5). Determines the shape of Actors and Items.

**Campaign**: A long-running game with one group, made up of a sequence of Adventures played within a Canon.

**Canon**: The authoritative body of Story Elements and Connections, independent of any World. Several Campaigns can be played within the same Canon. Usually changes only by merging an Adventure back into it.

**Adventure**: A branch of the Canon that a group plays through. Play changes the Adventure's World State; when the Adventure ends, those changes are merged back into the Canon (git-style).

**World**: A FoundryVTT world, bound to one Canon. A World always works on exactly one Checkout; Adventures that run in parallel need separate Worlds.

**Checkout**: The one line of the Canon a World is working on: either the Canon itself (Canon edit mode) or one Adventure. It changes only when an Adventure ends.

**Commit**: A saved, labelled point in an Adventure's or the Canon's history. Changes made in a World stay in the World until committed.

**World Canvas**: The canvas belonging to one Foundry world, where the GM lays out and works on that world's Story.

**Node**: The representation of one Story Element on a World Canvas. Where Nodes sit is part of the Canon, so every World and Adventure starts from the same layout.

**Behavioural Connection**: A Connection of a fixed type, valid only between certain Element Classes, that drives behaviour in Foundry or Silk (e.g. "owns", "present at"). All other Connections are free-form, with a label.

**Reveal**: The GM sharing a Story Element, a single Info Block, or a single Connection with the whole party of a Campaign. Revealing an Info Block or Connection also Reveals the Story Element(s) it belongs to, but nothing more. Can be undone.

**Revelation Map**: Everything Revealed so far in one Campaign. It belongs to the Campaign, not the Canon: every player in that Campaign, past or new, sees all of it, and another Campaign does not. The GM can merge two Campaigns' Revelation Maps when their groups join.

**Companion Journal**: The Journal Entry holding the Info Blocks of a Story Element whose Foundry document is not itself a Journal Entry (an Actor or Item).

**Cover**: The image a Revealed Story Element shows players first, before any of its Info Blocks are Revealed.

**Info Block**: A named piece of strategic Story information inside a Story Element's body. Each Info Block can be Revealed on its own, and only by the GM's deliberate choice. Not to be confused with tactical knowledge players earn through skill rolls, which stays a Game System mechanic.

**Player Note**: An Info Block the players write on a Story Element to record their own thoughts and findings. Player Notes are kept together on the element, become part of the Canon like other Info Blocks, and the GM can turn one into an ordinary Info Block.

**Materialize**: Pull a Story Element into the World by creating the Foundry document that represents it. Story Elements that are not Materialized exist only in the Canon and its branches. Whether Materializing happens immediately or on demand is a GM setting.

**Focus View**: A canvas mode that shows only the Story Elements within a few Connections of a focus (the active Foundry Scene and the actors in it, or an element the GM picks), and hides or dims the rest.

**Scene Preset**: One of a fixed set of templates (Travel, Battle, Narrative, Overview) that sets how a Story Element's Foundry Scene is set up for play.

**Canvas Filter**: A view setting that narrows which Story Elements the canvas shows (e.g. hide non-Materialized, by Tag, within N Connections of a focus). Filters never change the Story itself.

**Visual Group**: A labelled frame on a World Canvas that holds Nodes for the GM's overview. Visual Groups are layout: they are part of the Canon like Node positions, but do not change the Story.

**Connection Point**: A spot on a Node from which the GM drags out a Connection. The kind of Connection Point (outgoing, incoming or mutual) sets the new Connection's direction. Connections attach on the side of the Node that faces the other Node.

**Status**: The one toggleable state an Element Class may carry, e.g. dead for a Person, happened for an Event, open/done/failed for a Quest. Classes without one have no Status.

**Creation Pipeline**: The fixed sequence every way of creating a Story Element on the canvas ends in: pick the Element Class, type the name, and, if it was created from another Node, label the Connection.
